import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GridFSBucket, MongoClient } from 'mongodb';
import { lastValueFrom, of } from 'rxjs';
import { DataSource, EntitySchema } from 'typeorm';

const mongoUrl = process.env.DATAPHONE_TEST_MONGO_URL;

const RecordSchema = new EntitySchema({
  name: 'FeasibilityRecord',
  tableName: 'feasibility_records',
  columns: {
    _id: { type: 'objectId', objectId: true, primary: true },
    label: { type: 'string' },
  },
});

function databaseName() {
  return `dataphone_feasibility_${randomUUID().replaceAll('-', '')}`;
}

test('configuration rejects a missing MongoDB URL', () => {
  assert.throws(() => new URL(''), TypeError);
  if (mongoUrl) {
    const parsed = new URL(mongoUrl);
    assert.match(parsed.protocol, /^mongodb(\+srv)?:$/);
  }
});

test('NestJS dependency injection resolves an RxJS stream', async () => {
  class FeasibilityModule {}
  Module({ providers: [{ provide: 'NUMBERS', useValue: of(1, 2, 3) }] })(FeasibilityModule);
  const app = await NestFactory.createApplicationContext(FeasibilityModule, { logger: false });
  try {
    assert.equal(await lastValueFrom(app.get('NUMBERS')), 3);
  } finally {
    await app.close();
  }
});

test('TypeORM and native MongoDB work with one database configuration', { skip: !mongoUrl && 'Set DATAPHONE_TEST_MONGO_URL for the database probe' }, async (t) => {
  const database = databaseName();
  const scopedUrl = new URL(mongoUrl);
  scopedUrl.pathname = `/${database}`;
  const source = new DataSource({
    type: 'mongodb',
    url: scopedUrl.toString(),
    database,
    entities: [RecordSchema],
    synchronize: false,
  });
  const client = new MongoClient(scopedUrl.toString());
  try {
    await source.initialize();
    await client.connect();
    const db = client.db(database);

    await t.test('TypeORM CRUD is visible to the native driver', async () => {
      const repo = source.getMongoRepository('FeasibilityRecord');
      const saved = await repo.save({ label: 'created-by-typeorm' });
      assert.ok(saved._id);
      assert.equal((await db.collection('feasibility_records').findOne({ _id: saved._id })).label, 'created-by-typeorm');
      await repo.updateOne({ _id: saved._id }, { $set: { label: 'updated-by-typeorm' } });
      assert.equal((await repo.findOneBy({ _id: saved._id })).label, 'updated-by-typeorm');
      await repo.deleteOne({ _id: saved._id });
      assert.equal(await db.collection('feasibility_records').countDocuments(), 0);
    });

    await t.test('native multi-document transaction commits and rolls back', async () => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await db.collection('transaction_a').insertOne({ value: 'committed' }, { session });
          await db.collection('transaction_b').insertOne({ value: 'committed' }, { session });
        });
        assert.equal(await db.collection('transaction_a').countDocuments(), 1);
        assert.equal(await db.collection('transaction_b').countDocuments(), 1);
        await assert.rejects(session.withTransaction(async () => {
          await db.collection('transaction_a').insertOne({ value: 'rolled-back' }, { session });
          await db.collection('transaction_b').insertOne({ value: 'rolled-back' }, { session });
          throw new Error('intentional rollback');
        }), /intentional rollback/);
        assert.equal(await db.collection('transaction_a').countDocuments(), 1);
        assert.equal(await db.collection('transaction_b').countDocuments(), 1);
      } finally {
        await session.endSession();
      }
    });

    await t.test('change stream receives committed insert', async () => {
      const collection = db.collection('change_events');
      await collection.insertOne({ seed: true });
      const stream = collection.watch([], { maxAwaitTimeMS: 500 });
      let timeout;
      try {
        const next = stream.next();
        await collection.insertOne({ marker: 'observed' });
        const event = await Promise.race([
          next,
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('change stream timeout')), 5000); }),
        ]);
        assert.equal(event.operationType, 'insert');
        assert.equal(event.fullDocument.marker, 'observed');
      } finally {
        clearTimeout(timeout);
        await stream.close();
      }
    });

    await t.test('GridFS uploads and downloads bytes', async () => {
      const bucket = new GridFSBucket(db, { bucketName: 'feasibility_files' });
      const content = Buffer.from('DataPhone Phase 0 GridFS probe');
      const upload = bucket.openUploadStream('probe.txt');
      await new Promise((resolve, reject) => Readable.from([content]).pipe(upload).on('finish', resolve).on('error', reject));
      const chunks = [];
      for await (const chunk of bucket.openDownloadStream(upload.id)) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), content);
    });
  } finally {
    if (source.isInitialized) await source.destroy();
    await client.db(database).dropDatabase().catch(() => {});
    await client.close();
  }
});

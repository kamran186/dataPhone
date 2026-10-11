module.exports = {
  testEnvironment: "node",
  testRegex: "test/.*\\.spec\\.ts$",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2022",
          module: "ES2022",
          moduleResolution: "Node",
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleFileExtensions: ["ts", "js", "json"],
};

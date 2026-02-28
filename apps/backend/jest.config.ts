import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@eda/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@eda/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};

export default config;

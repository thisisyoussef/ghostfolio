/* eslint-disable */
export default {
  displayName: 'api',
  preset: '../../jest.preset.js',
  coverageDirectory: '../../coverage/apps/api',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json'
      }
    ]
  }
};

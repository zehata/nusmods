const commonConfig = require('./jest.common.config');

module.exports = {
  ...commonConfig,
  testRegex: 'src/.+\\.test\\.[jt]sx?$',
  testPathIgnorePatterns: [
    // Ignore integration tests, which are covered under integration test configs
    'src/.+\\.fuzzed\\.integration\\.test\\.[jt]sx?$',
  ],
};

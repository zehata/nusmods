const commonConfig = require('./jest.common.config');

module.exports = {
  ...commonConfig,
  testRegex: 'src/.+\\.integration\\.test\\.[jt]sx?$',
};

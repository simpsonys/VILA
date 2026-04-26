module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['*.js', '!jest.config.js'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/release_repo/']
};

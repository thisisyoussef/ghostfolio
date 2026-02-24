const { composePlugins, withNx } = require('@nx/webpack');

module.exports = composePlugins(withNx(), (config, { options, context }) => {
  // Mark yahoo-finance2 as external so webpack doesn't bundle it.
  // This package has complex internal module structure (cookies, fetch handlers)
  // that breaks when bundled by webpack. It must be resolved from node_modules at runtime.
  config.externals = config.externals || [];
  if (Array.isArray(config.externals)) {
    config.externals.push('yahoo-finance2');
  }
  return config;
});

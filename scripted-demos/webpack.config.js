var path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          presets: ['babel-preset-es2015'].map(require.resolve), // needs this otherwise code loaded from other dirs will fail because it tries to load the preset relative to that other dir, not this one. fixed in upcoming babel 7
        },
      },
    ],
  },
};

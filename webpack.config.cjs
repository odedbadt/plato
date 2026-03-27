// webpack.config.cjs
const path = require("path");

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: "development",
  context: __dirname,

  entry: "./src/ts/index.ts",

  output: {
    path: path.resolve(__dirname),
    filename: "bundle.js",
  },

  devtool: "source-map",

  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true },
        },
        exclude: /node_modules/,
      },
    ],
  },

  optimization: {
    minimize: false,
    concatenateModules: false,
    usedExports: false,
    moduleIds: "named",
    chunkIds: "named",
  },
};

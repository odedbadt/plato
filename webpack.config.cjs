// webpack.config.cjs
const path = require("path");

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: "development",
  context: __dirname,

  entry: {
    plato: "./plato/src/ts/index.ts",
    scrib: "./scrib/src/ts/index.ts",
  },

  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name]/bundle.js",
    clean: true,
    // nicer original paths under "webpack:///"
    devtoolModuleFilenameTemplate: info =>
      "webpack:///" +
      path
        .relative(__dirname, info.absoluteResourcePath)
        .replace(/\\/g, "/"),
  },

  // generate external *.map files (dist/plato/bundle.js.map, dist/scrib/bundle.js.map)
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
          options: {
            // let ts-loader use your tsconfig; it will turn sourceMap on when devtool is set
            transpileOnly: false, // better stack traces while you debug; flip to true if you want speed
          },
        },
        exclude: /node_modules/,
      },
    ],
  },

  optimization: {
    minimize: false,           // no minification: easier to read stacks
    concatenateModules: false, // avoid scope hoisting weirdness while debugging
    usedExports: false,
    moduleIds: "named",
    chunkIds: "named",
  },
};

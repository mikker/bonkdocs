const path = require('path')
const { getMetroConfig } = require('pear-runtime-react-native/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getMetroConfig(projectRoot)

config.watchFolders = [
  ...new Set([...(config.watchFolders || []), workspaceRoot])
]
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.join(projectRoot, 'node_modules'),
    path.join(workspaceRoot, 'node_modules')
  ]
}

module.exports = config

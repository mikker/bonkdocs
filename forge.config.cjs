const pkg = require('./package.json')
const appName = pkg.productName ?? pkg.name

const packagerConfig = {
  protocols: [{ name: appName, schemes: [pkg.name] }],
  derefSymlinks: true,
  osxSign: {
    identity: 'Developer ID Application: Mikkel Malmberg (DDB8SQMXS9)'
  },
  osxNotarize: {
    tool: 'notarytool',
    keychainProfile: 'TunaNotary'
  }
}

module.exports = {
  packagerConfig,

  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {}
    },
    {
      name: '@forkprince/electron-forge-maker-appimage',
      platforms: ['linux']
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ],

  plugins: [
    {
      name: 'electron-forge-plugin-universal-prebuilds',
      config: {}
    },
    {
      name: 'electron-forge-plugin-prune-prebuilds',
      config: {}
    }
  ]
}

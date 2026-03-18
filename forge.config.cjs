const pkg = require('./package.json')
const appName = pkg.productName ?? pkg.name

module.exports = {
  packagerConfig: {
    protocols: [{ name: appName, schemes: [pkg.name] }],
    osxSign: {
      identity: 'Developer ID Application: Mikkel Malmberg (DDB8SQMXS9)'
    },
    osxNotarize: {
      tool: 'notarytool',
      keychainProfile: 'TunaNotary'
    }
  },

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

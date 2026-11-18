// Ad-hoc sign the macOS app before the .dmg is made. There is no Apple
// Developer ID yet, so users open it the first time with right-click > Open.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(ctx) {
    if (ctx.electronPlatformName !== 'darwin') return;
    const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};

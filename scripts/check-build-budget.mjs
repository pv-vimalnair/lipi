import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'assets');
const mib = 1024 * 1024;
const kib = 1024;

const budgets = {
  totalAssets: 16 * mib,
  indexJs: 900 * kib,
  themeAsset: 500 * kib,
  themeAssetsTotal: 1.5 * mib,
  monacoCoreJs: 4.25 * mib,
  monacoTsWorkerJs: 6.25 * mib,
  monacoOtherWorkerJs: 1.25 * mib,
};

const themePrefixes = [
  '01-hickory-hollow',
  '02-whispering-pines',
  '03-marigold-field',
  '04-wildflower-field',
  '05-quiet-valley',
];

const entries = readdirSync(assetsDir)
  .map((name) => {
    const fullPath = path.join(assetsDir, name);
    return { name, fullPath, size: statSync(fullPath).size };
  })
  .filter((entry) => statSync(entry.fullPath).isFile());

const failures = [];
const warn = [];

const human = (bytes) => {
  if (bytes >= mib) return `${(bytes / mib).toFixed(2)} MiB`;
  return `${(bytes / kib).toFixed(1)} KiB`;
};

const checkMax = (label, actual, max) => {
  if (actual > max) failures.push(`${label}: ${human(actual)} > ${human(max)}`);
};

const sourceMaps = entries.filter((entry) => entry.name.endsWith('.map'));
if (process.env.LIPI_BUILD_SOURCEMAPS !== '1') {
  if (sourceMaps.length > 0) {
    failures.push(`release sourcemaps: ${sourceMaps.length} files > 0 files`);
  }
}

const budgetedEntries = entries.filter((entry) => !entry.name.endsWith('.map'));
const totalAssets = budgetedEntries.reduce((sum, entry) => sum + entry.size, 0);
checkMax('dist/assets total', totalAssets, budgets.totalAssets);

const indexJs = entries.find((entry) => /^index-.*\.js$/.test(entry.name));
if (indexJs) checkMax(indexJs.name, indexJs.size, budgets.indexJs);
else warn.push('index chunk not found');

const themeAssets = entries.filter(
  (entry) =>
    /\.(jpe?g|png|webp|avif)$/i.test(entry.name) &&
    themePrefixes.some((prefix) => entry.name.startsWith(prefix)),
);

const themeTotal = themeAssets.reduce((sum, entry) => sum + entry.size, 0);
checkMax('theme assets total', themeTotal, budgets.themeAssetsTotal);
for (const asset of themeAssets) {
  checkMax(asset.name, asset.size, budgets.themeAsset);
}

for (const entry of entries.filter((asset) => asset.name.endsWith('.js'))) {
  if (/^monaco-.*\.js$/.test(entry.name)) {
    checkMax(entry.name, entry.size, budgets.monacoCoreJs);
    continue;
  }
  if (/^ts\.worker-.*\.js$/.test(entry.name)) {
    checkMax(entry.name, entry.size, budgets.monacoTsWorkerJs);
    continue;
  }
  if (/\.(worker)-.*\.js$/.test(entry.name)) {
    checkMax(entry.name, entry.size, budgets.monacoOtherWorkerJs);
  }
}

if (failures.length > 0) {
  console.error('Build budget failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Build budget passed: assets ${human(totalAssets)}, themes ${human(themeTotal)}, sourcemaps ${sourceMaps.length}.`,
);
for (const message of warn) console.warn(`Build budget warning: ${message}`);

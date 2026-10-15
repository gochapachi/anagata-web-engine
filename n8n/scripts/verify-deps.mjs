// Verify the animation/3D deps are actually in package.json
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const deps = ['lenis', '@tsparticles/react', '@tsparticles/slim', 'three', '@react-three/fiber', '@react-three/drei'];
for (const d of deps) {
  console.log(`${d.padEnd(22)} ${pkg.dependencies?.[d] || pkg.devDependencies?.[d] || 'MISSING'}`);
}
// sanity: are the packages resolvable (node_modules present)?
for (const d of deps) {
  try {
    require.resolve(d + '/package.json');
    console.log(`  resolvable: ${d}`);
  } catch {
    console.log(`  NOT RESOLVABLE: ${d}`);
  }
}
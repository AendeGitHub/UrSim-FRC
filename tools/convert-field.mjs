// Converts the REBUILT field STEP (Field/Team_Practice_Field.step, exported from Onshape) into game assets:
//   public/assets/field.glb         — the visual model, one node per field element
//   public/assets/field-layout.json — the field's walls, element boxes and the FUEL start positions
//
// Run with: npm run convert:field   (~2 minutes; then build:colliders)
//
// The CAD is Z up; the game is Y up with the same X (red ALLIANCE WALL at -X): (x, y, z) → (x, z, -y).
// The game draws its own carpet and tape, so the CAD carpet is left out.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEP_FILE = path.join(ROOT, 'Field', 'Team_Practice_Field.step');
const OUT_DIR = path.join(ROOT, 'public', 'assets');

const FASTENER = /screw|nut\b|rivet|washer|bolt|cable tie|rivnut|fastener|hinge|latch|zip tie|standoff|spacer/i;
/** Nodes that collide in the physics (tools/build-colliders.mjs) */
const SOLID = /^(hub_|tower_|outpost_|depot_|bumps|trenches|perimeter)/;

function classify(meshName, names) {
  const p = names.join(' / ');
  if (/Carpet/i.test(p)) return 'skip';
  if (FASTENER.test(meshName) || FASTENER.test(names[names.length - 1] ?? '')) return 'skip';
  const side = n => (n === '1' ? 'red' : 'blue');
  let m;
  if ((m = p.match(/Practice Hub <(\d)>/))) return `hub_${side(m[1])}`;
  if ((m = p.match(/Practice Tower <(\d)>/))) return `tower_${side(m[1])}`;
  if ((m = p.match(/Practice Outpost <(\d)>/))) return `outpost_${side(m[1])}`;
  if ((m = p.match(/TE Depot <(\d)>/))) return `depot_${side(m[1])}`;
  if (/Practice Bump/.test(p)) return 'bumps';
  if (/Practice Trench/.test(p)) return 'trenches';
  if (/Perimeter/.test(p)) return 'perimeter';
  return 'misc';
}

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
function grow(b, pos) {
  for (let j = 0; j < pos.length; j += 3) for (let k = 0; k < 3; k++) {
    b.min[k] = Math.min(b.min[k], pos[j + k]);
    b.max[k] = Math.max(b.max[k], pos[j + k]);
  }
  return b;
}
const roundBox = b => ({ min: b.min.map(v => round(v)), max: b.max.map(v => round(v)) });

async function main() {
  console.log('Reading STEP (takes ~2 minutes)...');
  const occt = await require('occt-import-js')();
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP_FILE)), {
    linearUnit: 'meter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.005,
    angularDeflection: 0.7,
  });
  if (!res.success) throw new Error('STEP import failed');
  console.log(`Imported ${res.meshes.length} meshes`);

  const meshPath = new Map();
  (function walk(node, names) {
    const here = [...names, node.name];
    for (const i of node.meshes) meshPath.set(i, here);
    for (const c of node.children) walk(c, here);
  })(res.root, []);

  const groups = new Map();
  const boxes = {};
  /** The perimeter's pieces, to find the inner faces of its walls */
  const perimeterPieces = [];
  res.meshes.forEach((m, i) => {
    const kind = classify(m.name, meshPath.get(i) ?? []);
    if (kind === 'skip') return;
    const src = m.attributes.position.array;
    const pos = new Float32Array(src.length);
    for (let j = 0; j < src.length; j += 3) {
      pos[j] = src[j];
      pos[j + 1] = src[j + 2];
      pos[j + 2] = -src[j + 1];
    }
    grow((boxes[kind] ??= emptyBox()), pos);
    if (kind === 'perimeter') perimeterPieces.push(grow(emptyBox(), pos));
    const color = m.color ?? [0.6, 0.6, 0.6];
    const key = color.map(c => c.toFixed(3)).join(',');
    if (!groups.has(kind)) groups.set(kind, new Map());
    const byColor = groups.get(kind);
    if (!byColor.has(key)) byColor.set(key, { color, parts: [] });
    byColor.get(key).parts.push({ pos, idx: m.index.array });
  });

  // Inner faces of the guardrails (long sides) and ALLIANCE WALLS (ends): the walls' pieces that run
  // along a side, at least 1 m long and standing up to 15 cm off the floor.
  let halfZ = Infinity;
  for (const b of perimeterPieces) {
    const lx = b.max[0] - b.min[0], lz = b.max[2] - b.min[2];
    if (lx > 1 && lz < 0.25 && b.min[1] < 0.15 && Math.abs((b.min[2] + b.max[2]) / 2) > 3) halfZ = Math.min(halfZ, Math.min(Math.abs(b.min[2]), Math.abs(b.max[2])));
  }
  // The DEPOTS sit against the ALLIANCE WALLS.
  const halfX = Math.max(Math.abs(boxes.depot_red.min[0]), Math.abs(boxes.depot_blue.max[0]));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('field');
  const materials = new Map();
  const material = color => {
    const key = color.join(',');
    if (materials.has(key)) return materials.get(key);
    const grey = Math.abs(color[0] - color[1]) < 0.03 && Math.abs(color[1] - color[2]) < 0.03;
    const metal = grey && color[0] > 0.45;
    const mat = doc.createMaterial(key).setBaseColorFactor([...color.map(srgbToLinear), 1]).setDoubleSided(true)
      .setRoughnessFactor(metal ? 0.45 : 0.7).setMetallicFactor(metal ? 0.6 : 0);
    materials.set(key, mat);
    return mat;
  };
  for (const [kind, byColor] of groups) {
    const mesh = doc.createMesh(kind);
    for (const { color, parts } of byColor.values()) {
      let vc = 0, ic = 0;
      for (const p of parts) { vc += p.pos.length / 3; ic += p.idx.length; }
      const P = new Float32Array(vc * 3), I = new Uint32Array(ic);
      let vo = 0, io = 0;
      for (const p of parts) {
        P.set(p.pos, vo * 3);
        for (let j = 0; j < p.idx.length; j++) I[io + j] = p.idx[j] + vo;
        vo += p.pos.length / 3;
        io += p.idx.length;
      }
      mesh.addPrimitive(doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer))
        .setMaterial(material(color)));
    }
    const node = doc.createNode(kind).setMesh(mesh);
    if (SOLID.test(kind)) node.setExtras({ collider: 'trimesh' });
    scene.addChild(node);
  }

  await MeshoptSimplifier.ready;
  const tris = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);
  console.log(`Triangles before simplify: ${tris()}`);
  // No stored normals: the game rebuilds creased ones on load, and without them welding merges the
  // flat-shaded CAD's split vertices so simplification can work.
  await doc.transform(dedup(), weld({ tolerance: 0.0002 }), simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: 0.0015, lockBorder: false }), prune(), quantize());
  for (const mesh of doc.getRoot().listMeshes()) {
    console.log(`  ${mesh.getName().padEnd(14)} ${mesh.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0)}`);
  }
  console.log(`Triangles after simplify: ${tris()}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(path.join(OUT_DIR, 'field.glb'), doc);
  const layout = {
    wall: { halfX: round(halfX), halfZ: round(halfZ) },
    elements: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, roundBox(b)])),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'field-layout.json'), JSON.stringify(layout, null, 2) + '\n');
  console.log(`Wrote field.glb (${(fs.statSync(path.join(OUT_DIR, 'field.glb')).size / 1e6).toFixed(1)} MB)`);
  console.log(JSON.stringify(layout.wall));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

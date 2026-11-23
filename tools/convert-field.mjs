// Converts the REBUILT field STEP (Field/Team_Practice_Field.step, exported from Onshape) into
//   public/assets/field.glb          — the visual model, one node per field element
//   public/assets/field-layout.json  — each element's bounding box (to check game/field.ts)
//
// Run with: npm run convert:field   (takes ~2 minutes)
//
// The CAD is Z up; the game is Y up with the same X (red ALLIANCE WALL at -X): (x, y, z) → (x, z, -y).

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

const FASTENER = /screw|nut\b|rivet|washer|bolt|cable tie|rivnut|fastener|hinge|latch|zip/i;

/** Which game node a CAD part goes into, from its assembly path. */
function classify(meshName, names) {
  const p = names.join(' / ');
  if (/Carpet/i.test(p)) return 'skip'; // the game draws its own carpet and tape
  if (FASTENER.test(meshName)) return 'skip';
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

async function main() {
  console.log('Reading STEP (takes ~2 minutes)...');
  const occt = await require('occt-import-js')();
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP_FILE)), {
    linearUnit: 'meter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.004,
    angularDeflection: 0.6,
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
  res.meshes.forEach((m, i) => {
    const kind = classify(m.name, meshPath.get(i) ?? []);
    if (kind === 'skip') return;
    const src = m.attributes.position.array;
    const nsrc = m.attributes.normal?.array;
    const pos = new Float32Array(src.length);
    const nrm = new Float32Array(src.length);
    for (let j = 0; j < src.length; j += 3) {
      pos[j] = src[j];
      pos[j + 1] = src[j + 2];
      pos[j + 2] = -src[j + 1];
      if (nsrc) {
        nrm[j] = nsrc[j];
        nrm[j + 1] = nsrc[j + 2];
        nrm[j + 2] = -nsrc[j + 1];
      }
    }
    const b = (boxes[kind] ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    for (let j = 0; j < pos.length; j += 3) for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], pos[j + k]);
      b.max[k] = Math.max(b.max[k], pos[j + k]);
    }
    const color = m.color ?? [0.6, 0.6, 0.6];
    const key = color.map(c => c.toFixed(3)).join(',');
    if (!groups.has(kind)) groups.set(kind, new Map());
    const byColor = groups.get(kind);
    if (!byColor.has(key)) byColor.set(key, { color, parts: [] });
    byColor.get(key).parts.push({ pos, nrm, idx: m.index.array });
  });

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('field');
  const materials = new Map();
  const material = color => {
    const key = color.join(',');
    if (materials.has(key)) return materials.get(key);
    const grey = Math.abs(color[0] - color[1]) < 0.03 && Math.abs(color[1] - color[2]) < 0.03;
    const mat = doc.createMaterial(key).setBaseColorFactor([...color.map(srgbToLinear), 1]).setDoubleSided(true)
      .setRoughnessFactor(grey && color[0] > 0.45 ? 0.45 : 0.7).setMetallicFactor(grey && color[0] > 0.45 ? 0.6 : 0);
    materials.set(key, mat);
    return mat;
  };
  for (const [kind, byColor] of groups) {
    const mesh = doc.createMesh(kind);
    for (const { color, parts } of byColor.values()) {
      let vc = 0, ic = 0;
      for (const p of parts) { vc += p.pos.length / 3; ic += p.idx.length; }
      const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), I = new Uint32Array(ic);
      let vo = 0, io = 0;
      for (const p of parts) {
        P.set(p.pos, vo * 3);
        N.set(p.nrm, vo * 3);
        for (let j = 0; j < p.idx.length; j++) I[io + j] = p.idx[j] + vo;
        vo += p.pos.length / 3;
        io += p.idx.length;
      }
      mesh.addPrimitive(doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer))
        .setMaterial(material(color)));
    }
    scene.addChild(doc.createNode(kind).setMesh(mesh));
  }

  await MeshoptSimplifier.ready;
  const tris = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);
  console.log(`Triangles before simplify: ${tris()}`);
  await doc.transform(dedup(), weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: 0.003, lockBorder: false }), prune(), quantize());
  console.log(`Triangles after simplify: ${tris()}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(path.join(OUT_DIR, 'field.glb'), doc);
  const layout = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { min: b.min.map(v => round(v)), max: b.max.map(v => round(v)) }]));
  fs.writeFileSync(path.join(OUT_DIR, 'field-layout.json'), JSON.stringify(layout, null, 2) + '\n');
  console.log(`Wrote field.glb (${(fs.statSync(path.join(OUT_DIR, 'field.glb')).size / 1e6).toFixed(1)} MB)`);
  console.log(layout);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

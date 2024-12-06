// import { mat4 } from 'wgpu-matrix';
import { loadVoxelData } from "./loaders.js";
import { NodeRenderer } from "./NodeRenderer.js";

// TEST
// import { vec3, mat4 } from 'glm.js';
// import { getGlobalModelMatrix } from './engine/core/SceneUtils.js';
import {
	Camera,
	Material,
	Model,
	Node,
	Primitive,
	Sampler,
	Texture,
	Transform,
} from "./engine/core.js";

import { ResizeSystem } from "./engine/systems/ResizeSystem.js"
import { UpdateSystem } from './engine/systems/UpdateSystem.js';
import { TurntableController } from './engine/controllers/TurntableController.js';

import { JSONLoader } from "./engine/loaders/JSONLoader.js";
import { ImageLoader } from "./engine/loaders/ImageLoader.js";


const canvas = document.querySelector('canvas');
// VOXEL DATA
const voxelData = await loadVoxelData("./data/volumes_dens.raw");
const tempData = await loadVoxelData("./data/volumes_temp.raw");
// console.log(voxelData);

const renderer = new NodeRenderer(canvas);

await renderer.initialize();
await renderer.initializeVolume(voxelData, tempData);

const scene = new Node();

const camera = new Node();
camera.addComponent(new Transform({
    translation: [0, 1, 0],
}));
camera.addComponent(new Camera({near: 0.1, far: 100}));
camera.addComponent(new TurntableController(camera, canvas, { distance: 10, pitch: -0.1, }));

scene.addChild(camera);

const floor = new Node();
floor.addComponent(new Transform({
	scale: [10, 1, 10],
}));
floor.addComponent(new Model({
	primitives: [
		new Primitive({
			mesh: await new JSONLoader().loadMesh('./models/floor/floor.json'),
			material: new Material({
				baseTexture: new Texture({
					image: await new ImageLoader().load('./models/floor/grass.png'),
					sampler: new Sampler({
						minFilter: 'nearest',
						magFilter: 'nearest',
						addressModeU: 'repeat',
						addressModeV: 'repeat',
					}),
				}),
			}),
		}),
	],
}));
scene.addChild(floor);

const volume = renderer.getCurrentVolume();
const volumeNode = new Node();
volumeNode.addComponent(new Transform({ translation: [0, 5, 0], scale: [5, 5, 5], })); // volume should sit on top of the floor
volumeNode.addComponent(volume);

scene.addChild(volumeNode);


function update(t, dt) {
	scene.traverse(node => {
		for (const component of node.components) {
			component.update?.(t, dt);
		}
	});
}

let lastTime = performance.now();

function render() {
	const currTime = performance.now();
	const deltaTime = currTime - lastTime;
	lastTime = currTime;

	renderer.updateFrame(deltaTime);
	renderer.render(scene, camera);
}

function resize({ displaySize: { width, height } }) {
	camera.getComponentOfType(Camera).aspect = width / height;
}

new ResizeSystem({ canvas, resize }).start();
new UpdateSystem({ update, render }).start();

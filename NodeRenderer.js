import { mat4 } from "./lib/glm.js";
import { Volume } from './Volume.js';
import { Camera } from "./engine/core/Camera.js";
import { getLocalModelMatrix, getGlobalViewMatrix, getProjectionMatrix, getModels } from './engine/core/SceneUtils.js';
import { BaseRenderer } from './engine/renderers/BaseRenderer.js';

const vertexBufferLayout = {
    arrayStride: 20,
    attributes: [
        { name: 'position', shaderLocation: 0, offset: 0, format: 'float32x3' },
        { name: 'texcoords', shaderLocation: 1, offset: 12, format: 'float32x2' },
    ],
};

export class NodeRenderer extends BaseRenderer {

    constructor(canvas) {
        super(canvas);
    }

    async initialize() {
        await super.initialize();

        this.volume = null;
        this.volumeTemp = null;

        this.unlitPipeline = await this.initializeUnlitPipeline();
        this.volumePipeline = await this.initializeVolumePipeline();

        this.recreateDepthTexture();
    }

    getVolume() {
        if (this.volume) { return this.volume };
    }

    async initializeUnlitPipeline() {
        const code = await fetch(new URL("./shaders/UnlitRenderer.wgsl", import.meta.url)).then(response => response.text());
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vertex',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module,
                entryPoint: 'fragment',
                targets: [{ format: this.format }],
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
    }

    async initializeVolumePipeline() {
        // transparency, blending, source alpha
        const code = await fetch(new URL("./shaders/EAMRenderer.wgsl", import.meta.url)).then(response => response.text());
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vertex_main' },
            fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{
                    format: this.format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                    },
                    writeMask: GPUColorWrite.ALL,
                }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
    }

    recreateDepthTexture() {
        this.depthTexture?.destroy();
        this.depthTexture = this.device.createTexture({
            format: 'depth24plus',
            size: [this.canvas.width, this.canvas.height],
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    async initializeVolume(voxelData, tempData) {
        this.volume = new Volume(this.device, voxelData);
        this.volumeTemp = new Volume(this.device, tempData)
        await this.volume.load();
        await this.volumeTemp.load();
    }

    prepareNode(node) {
        if (this.gpuObjects.has(node)) {
            return this.gpuObjects.get(node);
        }

        const modelUniformBuffer = this.device.createBuffer({
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        var modelBindGroup = undefined;

        if (node.getComponentOfType(Volume)) {
            // console.log(this.volumeTemp);
            modelBindGroup = this.device.createBindGroup({
                layout: this.volumePipeline.getBindGroupLayout(1),
                entries: [
                    { binding: 0, resource: { buffer: modelUniformBuffer } },
                    { binding: 1, resource: this.volume.getTextureSampler() },
                    { binding: 2, resource: this.volume.getTextureView() },
                    { binding: 3, resource: this.volumeTemp.getTextureView() },
                ],
            });

            console.log("prepareNode if volume:");
            console.log(this.volume);

        } else {
            modelBindGroup = this.device.createBindGroup({
                layout: this.unlitPipeline.getBindGroupLayout(1),
                entries: [
                    { binding: 0, resource: { buffer: modelUniformBuffer } },
                ],
            });
        }

        console.log(modelBindGroup);

        const gpuObjects = { modelUniformBuffer, modelBindGroup };
        this.gpuObjects.set(node, gpuObjects);
        return gpuObjects;
    }

    prepareCamera(camera) {
        if (this.gpuObjects.has(camera)) {
            return this.gpuObjects.get(camera);
        }

        const cameraUniformBuffer = this.device.createBuffer({
            size: 128, // 192
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // UNLIT
        const cameraBindGroupUnlit = this.device.createBindGroup({
            layout: this.unlitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraUniformBuffer } },
            ],
        });

        // VOLUME
        const cameraBindGroupVolume = this.device.createBindGroup({
            layout: this.volumePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: cameraUniformBuffer } },
            ],
        });

        const gpuObjects = { cameraUniformBuffer, cameraBindGroupUnlit, cameraBindGroupVolume };
        this.gpuObjects.set(camera, gpuObjects);
        return gpuObjects;
    }

    prepareTexture(texture) {
        if (this.gpuObjects.has(texture)) {
            return this.gpuObjects.get(texture);
        }

        const { gpuTexture } = this.prepareImage(texture.image); // Assuming image loading is handled separately
        const { gpuSampler } = this.prepareSampler(texture.sampler);

        const gpuObjects = { gpuTexture, gpuSampler };
        this.gpuObjects.set(texture, gpuObjects);
        return gpuObjects;
    }

    prepareMaterial(material) {
        if (this.gpuObjects.has(material)) {
            return this.gpuObjects.get(material);
        }

        const baseTexture = this.prepareTexture(material.baseTexture);

        const materialUniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const materialBindGroup = this.device.createBindGroup({
            layout: this.unlitPipeline.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: { buffer: materialUniformBuffer } },
                { binding: 1, resource: baseTexture.gpuTexture.createView() },
                { binding: 2, resource: baseTexture.gpuSampler },
            ],
        });

        const gpuObjects = { materialUniformBuffer, materialBindGroup };
        this.gpuObjects.set(material, gpuObjects);
        return gpuObjects;
    }

    render(scene, camera) {
        if (this.depthTexture.width !== this.canvas.width || this.depthTexture.height !== this.canvas.height) {
            this.recreateDepthTexture();
        }

        // CAMERA
        const cameraComponent = camera.getComponentOfType(Camera);
        const viewMatrix = getGlobalViewMatrix(camera);
        const projectionMatrix = getProjectionMatrix(camera);

        const { cameraUniformBuffer, cameraBindGroupUnlit, cameraBindGroupVolume } = this.prepareCamera(cameraComponent);

        this.device.queue.writeBuffer(cameraUniformBuffer, 0, viewMatrix);
        this.device.queue.writeBuffer(cameraUniformBuffer, 64, projectionMatrix);

        const encoder = this.device.createCommandEncoder();

        // render pass for basic objects
        this.unlitPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: [1, 1, 1, 1],   // white
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        this.unlitPass.setPipeline(this.unlitPipeline);
        this.unlitPass.setBindGroup(0, cameraBindGroupUnlit);
        this.renderNode(scene, camera);
        this.unlitPass.end();

        // render pass for volume
        this.volumePass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                // clearValue: [0, 0, 0, 1],   // black
                loadOp: 'load',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                // depthClearValue: 1,
                depthLoadOp: 'load',
                depthStoreOp: 'discard',
            },
        });

        this.volumePass.setPipeline(this.volumePipeline);
        this.volumePass.setBindGroup(0, cameraBindGroupVolume);
        this.renderNode(scene, camera, true);
        this.volumePass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    renderNode(node, camera, isVolumePass = false, modelMatrix = mat4.create()) {

        const localMatrix = getLocalModelMatrix(node);
        modelMatrix = mat4.multiply(mat4.create(), modelMatrix, localMatrix);

        const { modelUniformBuffer, modelBindGroup } = this.prepareNode(node);
        const normalMatrix = mat4.normalFromMat4(mat4.create(), modelMatrix);

        if (node.getComponentOfType(Volume) && isVolumePass) {
            // volume pipeline
            // transparency
            const swapMatrix = new Float32Array([
                0, 1, 0, 0,     // Swapping X and Y
                1, 0, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ]);

            const volumeMatrix = mat4.multiply(mat4.create(), modelMatrix, swapMatrix);

            const viewMatrix = getGlobalViewMatrix(camera);
            const projectionMatrix = getProjectionMatrix(camera);

            const mvp = mat4.multiply(mat4.create(), projectionMatrix, viewMatrix);
            mat4.multiply(mvp, mvp, volumeMatrix);
            const inverseMvp = mat4.invert(mat4.create(), mvp);

            this.device.queue.writeBuffer(modelUniformBuffer, 0, volumeMatrix);
            this.device.queue.writeBuffer(modelUniformBuffer, 64, inverseMvp);

            this.volumePass.setBindGroup(1, modelBindGroup);
            this.volumePass.draw(3);

        } else if (!isVolumePass) {
            // unlit pipeline for regular nodes
            this.device.queue.writeBuffer(modelUniformBuffer, 0, modelMatrix);
            this.device.queue.writeBuffer(modelUniformBuffer, 64, normalMatrix);

            this.unlitPass.setBindGroup(1, modelBindGroup);

            for (const model of getModels(node)) {
                this.renderModel(model);
            }
        }

        // Recursively render child nodes
        for (const child of node.children) {
            this.renderNode(child, camera, isVolumePass, modelMatrix);
        }
    }

    renderModel(model) {
        for (const primitive of model.primitives) {
            this.renderPrimitive(primitive);
        }
    }

    renderPrimitive(primitive) {
        const { materialUniformBuffer, materialBindGroup } = this.prepareMaterial(primitive.material);
        this.device.queue.writeBuffer(materialUniformBuffer, 0, new Float32Array(primitive.material.baseFactor));
        this.unlitPass.setBindGroup(2, materialBindGroup);

        const { vertexBuffer, indexBuffer } = this.prepareMesh(primitive.mesh, vertexBufferLayout);
        this.unlitPass.setVertexBuffer(0, vertexBuffer);
        this.unlitPass.setIndexBuffer(indexBuffer, 'uint32');

        this.unlitPass.drawIndexed(primitive.mesh.indices.length);
    }

}
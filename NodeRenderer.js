import { mat4 } from "./lib/glm.js";
import { Volume } from './Volume.js';
import { Camera } from "./engine/core/Camera.js";
import { getLocalModelMatrix, getGlobalViewMatrix, getProjectionMatrix, getModels } from './engine/core/SceneUtils.js';
import { BaseRenderer } from './engine/renderers/BaseRenderer.js';

// bloom and emission 
// unorm -> float
// dat.gui
// evalvacija

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
        this.frame_i = 0;
        this.frameInterval = 100; // ms // 100
        this.timeElapsed = 0;
    }

    async initialize() {
        await super.initialize();

        this.HDRformat = 'rgba16float';

        this.volumes = [];
        this.volumesTemp = [];

        this.unlitPipeline = await this.initializeUnlitPipeline();
        this.volumePipeline = await this.initializeVolumePipeline();
        this.bloomDownsamplePipeline = await this.initializeBloomDownsamplePipeline();
        this.bloomUpsamplePipeline = await this.initializeBloomUpsamplePipeline();
        this.finalPipeline = await this.initializeFinalPipeline();

        this.recreateDepthTexture();
        this.recreateRenderTexture();
        this.recreateBloomTexture();
    }

    getCurrentVolume() {
        if (this.volumes) { return this.volumes[this.frame_i] };
    }

    async fetchShader(url) {
        const response = await fetch(new URL(url, import.meta.url));
        if (!response.ok) {
            throw new Error("Failed to load shader: ${url}");
        }
        return await response.text();
    }

    async initializeUnlitPipeline() {
        const code = await this.fetchShader("./shaders/UnlitRenderer.wgsl");
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipelineAsync({
            label: 'Unlit',
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
        const main = await this.fetchShader("./shaders/EAMRenderer.wgsl");
        const raymarching = await this.fetchShader("./shaders/raymarching.wgsl");
        const perlin = await this.fetchShader("./shaders/perlin.wgsl");
        const worley = await this.fetchShader("./shaders/worley.wgsl");
        const curl = await this.fetchShader("./shaders/curl.wgsl");

        const code = raymarching + '\n' + perlin + '\n' + worley + '\n' + curl + '\n' + main;

        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipeline({
            label: 'Volume',
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
        });
    }

    async initializeBloomDownsamplePipeline() {
        const code = await this.fetchShader("./shaders/bloom_downsample.wgsl");
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipeline({
            label: 'BloomDown',
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vertex_main',
            },
            fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{ format: this.HDRformat }], //HDR
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    async initializeBloomUpsamplePipeline() {
        const code = await this.fetchShader("./shaders/bloom_upsample.wgsl");
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipeline({
            label: 'BloomUP',
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vertex_main',
            },
            fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{ format: this.HDRformat }], //HDR
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    async initializeFinalPipeline() {
        const code = await this.fetchShader("./shaders/final.wgsl");
        const module = this.device.createShaderModule({ code });

        return this.device.createRenderPipeline({
            label: 'Final',
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vertex_main',
            },
            fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{ format: this.format }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    recreateDepthTexture() {
        this.depthTexture?.destroy();
        this.depthTexture = this.device.createTexture({
            format: 'depth24plus',
            size: [this.canvas.width, this.canvas.height],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    recreateRenderTexture() {
        this.renderTexture?.destroy();
        this.renderTexture = this.device.createTexture({
            format: this.format,
            size: [this.canvas.width, this.canvas.height],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    recreateBloomTexture() {
        this.bloomTexture?.destroy();
        this.bloomTexture = this.device.createTexture({
            format: this.HDRformat, // hdr
            size: [this.canvas.width, this.canvas.height],
            mipLevelCount: Math.floor(Math.log2(Math.max(this.canvas.width, this.canvas.height))) + 1,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    async initializeVolumeFrames(frameData) {
        const frames = [];
        // console.log(frameData);
        for (const data of frameData) {
            const frame = new Volume(this.device, data);
            await frame.load();
            frames.push(frame);
        }
        return frames;
    }

    async initializeVolume(voxelData, tempData) {
        this.volumes = await this.initializeVolumeFrames(voxelData);
        this.volumesTemp = await this.initializeVolumeFrames(tempData);

        // alpha za transfer
        const pallete = new Uint8Array([
            51, 51, 51, 255,    // Dark gray
            77, 77, 77, 255,    // Lighter gray
            102, 102, 102, 255, // Even lighter gray
            230, 77, 77, 255,   // Orange
            255, 230, 25, 255,  // Yellow
            255, 255, 153, 255  // Bright yellow-white
        ]);

        const colorTextureDesc = {
            size: [6],
            dimension: "1d",
            format: this.format, // rgba8unorm
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };

        this.colorTexture = this.device.createTexture(colorTextureDesc);

        this.device.queue.writeTexture(
            { texture: this.colorTexture },
            pallete,
            { bytesPerRow: 6 * 4 },
            { width: 6, height: 1, depthOrArrayLayers: 1 }
        );
    }

    updateFrame(deltaTime) {
        this.timeElapsed += deltaTime;

        if (this.timeElapsed >= this.frameInterval) {
            this.frame_i = (this.frame_i + 1) % this.volumes.length;
            // console.log(this.frame_i);
            this.timeElapsed -= this.frameInterval;
        }
    }

    prepareVolume(node) {
        const volumeUniformBuffer = this.device.createBuffer({
            size: 256, //128
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const volumeBindGroup = this.device.createBindGroup({
            layout: this.volumePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: volumeUniformBuffer } },
                { binding: 1, resource: this.volumes[this.frame_i].getTextureSampler() },
                { binding: 2, resource: this.volumes[this.frame_i].getTextureView() },
                { binding: 3, resource: this.volumesTemp[this.frame_i].getTextureView() },
                { binding: 4, resource: this.colorTexture.createView() },
                { binding: 5, resource: this.depthTexture.createView() },
            ],
        });

        const gpuObjects = { volumeUniformBuffer, volumeBindGroup };
        this.gpuObjects.set(node, gpuObjects);
        return gpuObjects;
    }

    prepareNode(node) {
        if (this.gpuObjects.has(node)) {
            return this.gpuObjects.get(node);
        }

        const modelUniformBuffer = this.device.createBuffer({
            size: 128, //128
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        var modelBindGroup = this.device.createBindGroup({
            layout: this.unlitPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: modelUniformBuffer } },
            ],
        });

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

    prepareBloom(mipLevels) {
        if (!this.bloomBindGroup) {
            this.bloomSamplerDown = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                mipmapFilter: 'linear',
            });

            this.bloomSamplerUp = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'repeat',
                addressModeV: 'repeat',
                mipmapFilter: 'linear',
            });
        }

        // console.log(this.renderTexture);
        const bloomBindGroupsDownsample = [];
        const bloomBindGroupsUpsample = [];

        for (let i = 0; i < mipLevels; i++) {
            const resource = i === 0
                ? this.renderTexture.createView()
                : this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 });

            const downsampleBindGroup = this.device.createBindGroup({
                layout: this.bloomDownsamplePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: resource },
                    { binding: 1, resource: this.bloomSamplerDown },
                ],
            });

            const upsampleBindGroup = this.device.createBindGroup({
                layout: this.bloomUpsamplePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }) },
                    { binding: 1, resource: this.bloomSamplerUp },
                ],
            });

            bloomBindGroupsDownsample.push(downsampleBindGroup);
            bloomBindGroupsUpsample.push(upsampleBindGroup);
        };

        this.bloomBindGroupsDownsample = bloomBindGroupsDownsample;
        this.bloomBindGroupsUpsample = bloomBindGroupsUpsample;
    }

    prepareFinal() {
        if (!this.finalBindGroup) {
            this.finalSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });
        }

        this.finalBindGroup = this.device.createBindGroup({
            layout: this.finalPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.renderTexture.createView() },
                { binding: 1, resource: this.bloomTexture.createView() },
                { binding: 2, resource: this.finalSampler },
            ],
        });
    }
 
    render(scene, camera) {
        if (this.depthTexture.width !== this.canvas.width || this.depthTexture.height !== this.canvas.height) {
            this.recreateDepthTexture();
            this.recreateRenderTexture();
            this.recreateBloomTexture();
        }

        // CAMERA
        const cameraComponent = camera.getComponentOfType(Camera);
        const viewMatrix = getGlobalViewMatrix(camera);
        const projectionMatrix = getProjectionMatrix(camera);

        const { cameraUniformBuffer, cameraBindGroupUnlit, cameraBindGroupVolume } = this.prepareCamera(cameraComponent);

        this.device.queue.writeBuffer(cameraUniformBuffer, 0, viewMatrix);
        this.device.queue.writeBuffer(cameraUniformBuffer, 64, projectionMatrix);

        const unlitEncoder = this.device.createCommandEncoder({ label: "Unlit", });

        // render pass for basic objects
        this.unlitPass = unlitEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.renderTexture.createView(),
                clearValue: [0, 0, 0, 1],   // white 1, 1, 1
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

        this.device.queue.submit([unlitEncoder.finish()]);

        // render pass for volume
        const volumeEncoder = this.device.createCommandEncoder({ label: "Volume", });

        this.volumesPass = volumeEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.renderTexture.createView(),
                // clearValue: [0, 0, 0, 1],   // black
                loadOp: 'load',
                storeOp: 'store',
            }],
        });

        this.volumesPass.setPipeline(this.volumePipeline);
        this.volumesPass.setBindGroup(0, cameraBindGroupVolume);
        this.renderNode(scene, camera, true);
        this.volumesPass.end();

        this.device.queue.submit([volumeEncoder.finish()]);

        // render pass for extracting bright regions

        // render pass for bloom
        const bloomEncoder = this.device.createCommandEncoder({ label: "Bloom", });
        const mipLevels = this.bloomTexture.mipLevelCount;
        this.prepareBloom(mipLevels);

        // downsampling
        for (let i = 1; i < mipLevels; i++) {
            const bloomDowmsamplePass = bloomEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });

            bloomDowmsamplePass.setPipeline(this.bloomDownsamplePipeline);
            bloomDowmsamplePass.setBindGroup(0, this.bloomBindGroupsDownsample[i - 1]);
            bloomDowmsamplePass.draw(6);
            bloomDowmsamplePass.end();
        };

        // upsampling
        for (let i = mipLevels - 2; i >= 0; i--) {
            const bloomUpsamplePass = bloomEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });

            bloomUpsamplePass.setPipeline(this.bloomUpsamplePipeline);
            bloomUpsamplePass.setBindGroup(0, this.bloomBindGroupsUpsample[i + 1]);
            bloomUpsamplePass.draw(6);
            bloomUpsamplePass.end();
        };

        this.device.queue.submit([bloomEncoder.finish()]);

        // final render pass
        const finalEncoder = this.device.createCommandEncoder({ label: "Final", });
        this.prepareFinal();

        this.finalPass = finalEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                loadOp: 'load',
                storeOp: 'store',
            }],
        });

        this.finalPass.setPipeline(this.finalPipeline);
        this.finalPass.setBindGroup(0, this.finalBindGroup);
        this.finalPass.draw(6);
        this.finalPass.end();

        this.device.queue.submit([finalEncoder.finish()]);
    }

    renderNode(node, camera, isVolumePass = false, modelMatrix = mat4.create()) {

        const localMatrix = getLocalModelMatrix(node);
        modelMatrix = mat4.multiply(mat4.create(), modelMatrix, localMatrix);
        const normalMatrix = mat4.normalFromMat4(mat4.create(), modelMatrix);

        if (node.getComponentOfType(Volume) && isVolumePass) {
            const { volumeUniformBuffer, volumeBindGroup } = this.prepareVolume(node);
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

            this.device.queue.writeBuffer(volumeUniformBuffer, 0, volumeMatrix);
            this.device.queue.writeBuffer(volumeUniformBuffer, 64, inverseMvp);

            this.volumesPass.setBindGroup(1, volumeBindGroup);
            this.volumesPass.draw(3);

        } else if (!isVolumePass && !node.getComponentOfType(Volume)) {
            const { modelUniformBuffer, modelBindGroup } = this.prepareNode(node);
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
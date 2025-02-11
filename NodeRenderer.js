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

const noiseTypeMapping = {
    "Perlin": 1,
    "Worley": 2,
    "Worley + Curl": 3,
};

const resolutionTypeMapping = {
    "Full": 1,
    "Halved": 2,
    "Quartered": 4,
};

export class NodeRenderer extends BaseRenderer {

    constructor(canvas) {
        super(canvas);
        this.frame_i = 0;
        this.animationSpeed = 100; // ms
        this.timeElapsed = 0;
        this.timeNoise = 0;
    }

    async initialize() {
        await super.initialize();

        this.HDRformat = 'rgba16float';

        this.volumes = [];
        this.volumesTemp = [];

        // settings
        this.numSteps = 64;
        this.resolution = 'Quartered';
        this.pastRes = 'Quartered';
        this.resolutionFactor = resolutionTypeMapping[this.resolution];
        this.volumeOpacity = 30.0;
        this.bloomIntensity = 0.8;
        this.bloomThreshold = 1.0;
        this.noiseType = 'Worley + Curl';
        this.showNoise = false;
        this.stopAnimation = false;

        this.unlitPipeline = await this.initializeUnlitPipeline();
        this.volumePipeline = await this.initializeVolumePipeline();
        this.brightPipeline = await this.initializeBrightPipeline();
        this.bloomDownsamplePipeline = await this.initializeBloomDownsamplePipeline();
        this.bloomUpsamplePipeline = await this.initializeBloomUpsamplePipeline();
        this.finalPipeline = await this.initializeFinalPipeline();

        this.recreateDepthTexture();
        this.recreateRenderTexture();
        this.recreateBloomTexture();

        this.createTimestamp();
    }

    createTimestamp() {
        this.querySet = this.device.createQuerySet({
            type: "timestamp",
            count: 12,  // 6 render passes * 2 timestamps
        });

        this.queryBuffer = this.device.createBuffer({
            label: "Query",
            size: 8 * 12,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });

        this.readBuffer = this.device.createBuffer({
            label: "Read",
            size: 8 * 12,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
    }

    async copyBuffer() {
        const copyEncoder = this.device.createCommandEncoder();
        copyEncoder.copyBufferToBuffer(this.queryBuffer, 0, this.readBuffer, 0, this.queryBuffer.size);
        this.device.queue.submit([copyEncoder.finish()]);
        await this.readBuffer.mapAsync(GPUMapMode.READ);
    }

    async printTimestamp(renderInfo) {
        if (this.readBuffer.mapState == "unmapped") {
            const labels = ["Unlit", "Volume", "Bright", "Bloom Downsample", "Bloom Upsample", "Final"];
            await this.copyBuffer();
            const time = new BigInt64Array(this.readBuffer.getMappedRange());

            let info = "Render Pass duration:<br><br>"
            for (let i = 0; i < labels.length; i++) {
                let duration = Number(time[i * 2 + 1] - time[i * 2])
                duration /= 1_000_000
                info += `${labels[i]}: ${duration.toFixed(2)} ms<br>`;
            }

            renderInfo.innerHTML = info;
            this.readBuffer.unmap();
        }
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
                targets: [{ format: this.HDRformat }],
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
    }

    async initializeVolumePipeline() {
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
                    format: this.HDRformat,
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
                targets: [{
                    format: this.HDRformat,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one',
                            operation: 'add',
                        },
                    },
                    writeMask: GPUColorWrite.ALL,
                }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    async initializeBrightPipeline() {
        const code = await this.fetchShader("./shaders/bright.wgsl");
        const module = this.device.createShaderModule({ code });

        return this.device.createComputePipeline({
            label: 'Bright',
            layout: 'auto',
            compute: { module, entryPoint: 'main' },
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
            size: [this.canvas.width / this.resolutionFactor, this.canvas.height / this.resolutionFactor],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    recreateRenderTexture() {
        this.renderTexture?.destroy();
        this.renderTexture = this.device.createTexture({
            format: this.HDRformat,
            size: [this.canvas.width / this.resolutionFactor, this.canvas.height / this.resolutionFactor],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    recreateBloomTexture() {
        this.bloomTexture?.destroy();
        this.bloomTexture = this.device.createTexture({
            format: this.HDRformat,
            size: [this.canvas.width / this.resolutionFactor, this.canvas.height / this.resolutionFactor],
            mipLevelCount: Math.ceil(Math.log2(Math.max(this.canvas.width / this.resolutionFactor, this.canvas.height / this.resolutionFactor))),
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
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

        // HDR
        const palette = new Float32Array([
            0.2, 0.2, 0.2, 1.0,    // Dark gray
            0.3, 0.3, 0.3, 1.0,    // Lighter gray
            0.4, 0.4, 0.4, 1.0,    // Even lighter gray
            1.5, 0.4, 0.4, 1.0,    // Orange
            1.8, 1.2, 0.1, 1.0,    // Yellow 
            2.0, 2.0, 0.8, 1.0     // Bright yellow-white
        ]);

        const colorTextureDesc = {
            size: [6],
            dimension: "1d",
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };

        this.colorTexture = this.device.createTexture(colorTextureDesc);

        this.device.queue.writeTexture(
            { texture: this.colorTexture },
            palette,
            { bytesPerRow: 6 * 4 * 4 }, // 6 * 4 ldr
            { width: 6, height: 1, depthOrArrayLayers: 1 }
        );
    }

    updateFrame(deltaTime) {
        this.timeElapsed += deltaTime;

        if (this.timeElapsed >= this.animationSpeed && !this.stopAnimation) {
            this.frame_i = (this.frame_i + 1) % this.volumes.length;
            // console.log(this.frame_i);
            this.timeNoise = performance.now() / 1000;
            // console.log(this.timeNoise);
            this.timeElapsed -= this.animationSpeed;
        }
    }

    prepareVolume(node) {
        const volumeUniformBuffer = this.device.createBuffer({
            size: 256, //128
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const opacityBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const timeBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const stepsBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const noiseBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const showNoiseBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(opacityBuffer, 0, new Float32Array([this.volumeOpacity]));
        this.device.queue.writeBuffer(timeBuffer, 0, new Float32Array([this.timeNoise]));
        this.device.queue.writeBuffer(stepsBuffer, 0, new Uint32Array([this.numSteps]));
        this.device.queue.writeBuffer(noiseBuffer, 0, new Uint32Array([noiseTypeMapping[this.noiseType]]));
        this.device.queue.writeBuffer(showNoiseBuffer, 0, new Uint32Array([this.showNoise == true ? 1 : 0]));

        const volumeBindGroup = this.device.createBindGroup({
            layout: this.volumePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: volumeUniformBuffer } },
                { binding: 1, resource: this.volumes[this.frame_i].getTextureSampler() },
                { binding: 2, resource: this.volumes[this.frame_i].getTextureView() },
                { binding: 3, resource: this.volumesTemp[this.frame_i].getTextureView() },
                { binding: 4, resource: this.colorTexture.createView() },
                { binding: 5, resource: this.depthTexture.createView() },
                { binding: 6, resource: { buffer: opacityBuffer } },
                { binding: 7, resource: { buffer: timeBuffer } },
                { binding: 8, resource: { buffer: stepsBuffer } },
                { binding: 9, resource: { buffer: noiseBuffer } },
                { binding: 10, resource: { buffer: showNoiseBuffer } }
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
            this.bloomSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });
        }

        const bloomBindGroupsDownsample = [];
        const bloomBindGroupsUpsample = [];

        for (let i = 0; i < mipLevels; i++) {
            const downsampleBindGroup = this.device.createBindGroup({
                layout: this.bloomDownsamplePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }) },
                    { binding: 1, resource: this.bloomSampler },
                ],
            });

            const intensityBuffer = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            this.device.queue.writeBuffer(intensityBuffer, 0, new Float32Array([this.bloomIntensity]));

            const upsampleBindGroup = this.device.createBindGroup({
                layout: this.bloomUpsamplePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }) },
                    { binding: 1, resource: this.bloomSampler },
                    { binding: 2, resource: { buffer: intensityBuffer } },
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

    prepareBright() {
        const thresholdBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(thresholdBuffer, 0, new Float32Array([this.bloomThreshold]));

        this.brightBindGroup = this.device.createBindGroup({
            layout: this.brightPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: thresholdBuffer } },
                { binding: 1, resource: this.renderTexture.createView() },
                { binding: 2, resource: this.bloomTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
            ],
        });
    }

    render(scene, camera) {
        if (this.depthTexture.width !== Math.floor(this.canvas.width / this.resolutionFactor) || this.depthTexture.height !== Math.floor(this.canvas.height / this.resolutionFactor) || this.resolution !== this.pastRes) {
            this.resolutionFactor = resolutionTypeMapping[this.resolution];

            this.recreateDepthTexture();
            this.recreateRenderTexture();
            this.recreateBloomTexture();

            this.pastRes = this.resolution;
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
                clearValue: [0.1, 0.3, 0.8, 1],   // white 1, 1, 1
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1,
                depthCompare: "less",
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
            timestampWrites: {
                querySet: this.querySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1,
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
            timestampWrites: {
                querySet: this.querySet,
                beginningOfPassWriteIndex: 2,
                endOfPassWriteIndex: 3,
            }
        });

        this.volumesPass.setPipeline(this.volumePipeline);
        this.volumesPass.setBindGroup(0, cameraBindGroupVolume);
        this.renderNode(scene, camera, true);
        this.volumesPass.end();

        this.device.queue.submit([volumeEncoder.finish()]);

        // render pass for extracting bright regions
        const brightEncoder = this.device.createCommandEncoder({ label: "Bright", });
        this.prepareBright();

        const brightPass = brightEncoder.beginComputePass({
            timestampWrites: {
                querySet: this.querySet,
                beginningOfPassWriteIndex: 4,
                endOfPassWriteIndex: 5,
            },
        });

        brightPass.setPipeline(this.brightPipeline);
        brightPass.setBindGroup(0, this.brightBindGroup);

        brightPass.dispatchWorkgroups(
            Math.ceil(this.renderTexture.width / 8),
            Math.ceil(this.renderTexture.height / 8),
        );

        brightPass.end();

        this.device.queue.submit([brightEncoder.finish()]);

        // render pass for bloom
        const bloomEncoder = this.device.createCommandEncoder({ label: "Bloom", });
        const mipLevels = this.bloomTexture.mipLevelCount;
        this.prepareBloom(mipLevels);

        // downsampling
        for (let i = 1; i < mipLevels; i++) {
            const writeStart = (i === 1) ? 6 : undefined;
            const writeEnd = (i === mipLevels - 1) ? 7 : undefined;

            const bloomDowmsamplePass = bloomEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                timestampWrites: writeStart !== undefined || writeEnd !== undefined ? {
                    querySet: this.querySet,
                    beginningOfPassWriteIndex: writeStart,
                    endOfPassWriteIndex: writeEnd,
                } : undefined,
            });

            bloomDowmsamplePass.setPipeline(this.bloomDownsamplePipeline);
            bloomDowmsamplePass.setBindGroup(0, this.bloomBindGroupsDownsample[i - 1]);
            bloomDowmsamplePass.draw(6);
            bloomDowmsamplePass.end();
        };

        // upsampling
        for (let i = mipLevels - 2; i >= 0; i--) {
            const writeStart = (i === mipLevels - 2) ? 8 : undefined;
            const writeEnd = (i === 0) ? 9 : undefined;

            const bloomUpsamplePass = bloomEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.bloomTexture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                    loadOp: 'load',
                    storeOp: 'store',
                }],
                timestampWrites: writeStart !== undefined || writeEnd !== undefined ? {
                    querySet: this.querySet,
                    beginningOfPassWriteIndex: writeStart,
                    endOfPassWriteIndex: writeEnd,
                } : undefined,
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
                loadOp: 'clear',
                storeOp: 'store',
            }],
            timestampWrites: {
                querySet: this.querySet,
                beginningOfPassWriteIndex: 10,
                endOfPassWriteIndex: 11,
            },
        });

        this.finalPass.setPipeline(this.finalPipeline);
        this.finalPass.setBindGroup(0, this.finalBindGroup);
        this.finalPass.draw(6);
        this.finalPass.end();

        finalEncoder.resolveQuerySet(this.querySet, 0, 12, this.queryBuffer, 0);

        this.device.queue.submit([finalEncoder.finish()]);
    }

    renderNode(node, camera, isVolumePass = false, modelMatrix = mat4.create()) {

        const localMatrix = getLocalModelMatrix(node);
        modelMatrix = mat4.multiply(mat4.create(), modelMatrix, localMatrix);
        const normalMatrix = mat4.normalFromMat4(mat4.create(), modelMatrix);

        if (node.getComponentOfType(Volume) && isVolumePass) {
            const { volumeUniformBuffer, volumeBindGroup } = this.prepareVolume(node);
            // volume pipeline
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
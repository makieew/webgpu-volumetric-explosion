import { loadShader } from './loaders.js';
import { Volume } from './Volume.js';

export class EAMRenderer {


    constructor() {
        return (async () => {
            
            this.canvas = document.querySelector('canvas');

            this.adapter = await navigator.gpu.requestAdapter();
            this.device = await this.adapter.requestDevice();

            this.context = this.canvas.getContext('webgpu');
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            
            this.setCanvasDimensions();
            window.addEventListener('resize', this.setCanvasDimensions.bind(this));

            this.pipeline = await this.initializePipeline();

            this.uniformBuffer = this.device.createBuffer({
                size: 96, // probaj 64
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // this.renderTarget = this.device.createTexture({
            //     size: [this.canvas.width, this.canvas.height],
            //     sampleCount: 1,
            //     format: this.presentationFormat,
            //     usage: GPUTextureUsage.RENDER_ATTACHMENT,
            // });

            // this.view = this.renderTarget.createView();

            this.volume = null; // ONE FRAME

            this.volumeBindGroup = null;

            return this;
        })();
    }

    setCanvasDimensions() {
        const pixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = document.body.clientWidth * pixelRatio;
        this.canvas.height = document.body.clientHeight * pixelRatio;

        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied'
        });
    };

    async initializeVolume(voxelData) {
        this.volume = new Volume(this.device, voxelData);
        await this.volume.load();

        this.volumeBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.volume.getTextureSampler() },
                { binding: 2, resource: this.volume.getTextureView() }
            ]
        });
    }

    async initializePipeline() {

        const shaderCode = await loadShader("./shaders/EAMRenderer.wgsl")

        const shaderModule = this.device.createShaderModule({
            code: shaderCode,
        });

        const pipeline = this.device.createRenderPipeline({
            layout: "auto", // probaj
            vertex: {
                module: shaderModule,
                entryPoint: "vertex_main",
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragment_main",
                targets: [{
                    format: this.presentationFormat,
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
            multisample: {
                count: 1,  // No multisampling
            },
        });

        console.log(this.device);
        return pipeline;
    }

    render() {

        console.log(this.volume);

        const identityMatrix = new Float32Array([
            0, 1, 0, 0,     // Swapping X and Y
            1, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, identityMatrix);
        // ziga shader test
        // this.device.queue.writeBuffer(this.uniformBuffer, 64, new Float32Array([
        //     1.0 / 64,     //1, 64         // uniforms.stepSize
        //     Math.random(),    //0  // uniforms.offset
        //     100   //100,0                       // uniforms.extinction
        // ]));

        const renderPassDescriptor = {
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },  // Red clear color
                loadOp: 'clear',
                storeOp: 'store',
            }],
        };

        // renderPassDescriptor.colorAttachments[0].resolveTarget = this.context.getCurrentTexture().createView();
        
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.volumeBindGroup);

        passEncoder.draw(3);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
    

}
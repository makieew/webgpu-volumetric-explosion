export class Volume {

    constructor(device, data) {
        this.device = device;
        this.data = data;
        this.texture = null;
        this.textureSampler = null;
        this.ready = false;
    }

    async load() {
        this.ready = false;

        const [width, height, depth] = [32, 32, 32];    //HARDCODED

        if (this.texture) {
            this.texture.destroy();
        }

        this.texture = this.device.createTexture({
            size: [width, height, depth],
            dimension: "3d",
            format: "r8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.textureSampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear"
        });

        this.device.queue.writeTexture(
            {
                texture: this.texture
                // origin: { x: 0, y: 0, z: 0 }
            },
            this.data,
            {
                offset: 0,
                bytesPerRow: width,
                rowsPerImage: height
            },
            [
                width,
                height,
                depth
            ]
        );

        this.ready = true;
    }

    getTexture() {
        return this.ready ? this.texture : null;
    }

    getTextureSampler() {
        return this.ready ? this.textureSampler : null;
    }

    getTextureView() {
        return this.ready ? this.texture.createView() : null;
    }

    setFilter(filter) {
        this.textureSampler = this.device.createSampler({
            magFilter: filter,
            minFilter: filter
        });
    }
}
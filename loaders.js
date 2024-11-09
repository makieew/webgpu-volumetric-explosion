export async function loadVoxelData(url) {

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch data: ${response.statusText}");
        }

        const fetchedData = new Uint8Array(await response.arrayBuffer());
        const frameSize = 32 * 32 * 32;
        const frameN = 70;

        const voxelData = [];

        for (let i = 0; i < frameN; i++) {
            const frameStart = i * frameSize;
            const frameEnd = frameStart + frameSize;
            voxelData.push(fetchedData.slice(frameStart, frameEnd));
        }

        return voxelData;

    } catch (error) {
        console.log("Failed to fetch data: ", error);
    } 
}

export async function loadShader(url) {
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to load shader: ${response.statusText}");
        }
        return response.text();

    } catch (error) {
        console.log("Failed to load shader: ", error);
    }
}
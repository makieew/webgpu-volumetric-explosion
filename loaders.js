export async function loadVoxelData(url) {

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch data: ${response.statusText}");
        }

        const fetchedData = new Uint8Array(await response.arrayBuffer());
        const voxelData = [];

        // Reconstructing the voxel data array
        // TEST 1 FRAME
        // TODO: 70 frames

        return fetchedData;

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
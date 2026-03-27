export function floodfill(
    read_ctx: CanvasRenderingContext2D,
    write_ctx: CanvasRenderingContext2D,
    replaced_color: Uint8ClampedArray,
    new_color: [number, number, number, number],
    x: number,
    y: number,
    w: number,
    h: number
): void {
    const image_data = read_ctx.getImageData(0, 0, w, h);
    const data = image_data.data;

    const [tr, tg, tb, ta] = replaced_color;
    const [nr, ng, nb, na] = new_color;

    if (tr === nr && tg === ng && tb === nb && ta === na) return;

    const stack: number[] = [Math.round(y) * w + Math.round(x)];
    const visited = new Uint8Array(w * h);

    while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx]) continue;
        visited[idx] = 1;

        const pixel_offset = idx * 4;
        if (
            data[pixel_offset] !== tr ||
            data[pixel_offset + 1] !== tg ||
            data[pixel_offset + 2] !== tb ||
            data[pixel_offset + 3] !== ta
        ) continue;

        data[pixel_offset] = nr;
        data[pixel_offset + 1] = ng;
        data[pixel_offset + 2] = nb;
        data[pixel_offset + 3] = na;

        const px = idx % w;
        const py = Math.floor(idx / w);
        if (px > 0) stack.push(idx - 1);
        if (px < w - 1) stack.push(idx + 1);
        if (py > 0) stack.push(idx - w);
        if (py < h - 1) stack.push(idx + w);
    }

    write_ctx.putImageData(image_data, 0, 0);
}

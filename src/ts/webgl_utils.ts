
import * as glMatrix from 'gl-matrix'
import type { Rect } from "@oded/tsutils/vec2";

type Uniforms = {
    [key: string]: {
        type: string,
        value: any
    }
}
type Model = {
    vertices: Array<number>,
    colors?: Array<number>,
    normals?: Array<number>,
    texture?: Array<number>
}
function isPowerOf2(value: number) {
    return (value & (value - 1)) === 0;
}

export function create_vertex_buffer(gl: WebGLRenderingContext, vertices: Array<number>): WebGLBuffer {
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
        throw new Error("Failed to create vertex buffer" + gl.getError());
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.STATIC_DRAW
    );
    return vertexBuffer;
}

export function create_color_buffer(gl: WebGLRenderingContext, colors: Array<number>): WebGLBuffer | null {
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    return colorBuffer;
}

export function create_normal_buffer(gl: WebGLRenderingContext, normals: Array<number>): WebGLBuffer | null {
    if (!normals) {
        return null;
    }
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    return normalBuffer;
}

export function create_texture_buffer(gl: WebGLRenderingContext, textureCoords: Array<number>): WebGLBuffer {
    const textureCoordBuffer = gl.createBuffer();
    if (!textureCoordBuffer) {
        throw new Error("Failed to create texture Coord buffer " + gl.getError());
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
    return textureCoordBuffer;
}
export function create_index_buffer(gl: WebGLRenderingContext, indices: Array<number>): WebGLBuffer {
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
        throw new Error("Failed to create index buffer " + gl.getError());
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW
    );

    return indexBuffer;
}

export function compile_vertex_shader(gl: WebGLRenderingContext, vsSource: string): WebGLShader {
    const vertexShader: WebGLShader | null = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) {
        throw new Error("Failed initializing WebGL Context: " + gl.getError());
    }
    gl.shaderSource(vertexShader, vsSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        throw new Error(
            "Vertex shader compilation failed: " +
            gl.getShaderInfoLog(vertexShader)
        );
    }

    return vertexShader;
}
export function compile_fragment_shader(gl: WebGLRenderingContext, fsSource: string): WebGLShader {
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
        throw new Error("Failed creating fragment shader: " + gl.getError());
    }
    gl.shaderSource(fragmentShader, fsSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        console.error('Version: ' + gl.getParameter(gl.VERSION));
        throw new Error(
            "Fragment shader compilation failed: " +
            gl.getShaderInfoLog(fragmentShader)
        );
    }
    return fragmentShader;
}

export function create_shader_program(gl: WebGLRenderingContext): WebGLProgram | null {
    const shaderProgram = gl.createProgram();
    if (!shaderProgram) {
        throw new Error("Failed creating shader program" +
            gl.getError());
    }
    return shaderProgram;
}

export function link_shaders(gl: WebGLRenderingContext, shaderProgram: WebGLProgram, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
    gl.useProgram(shaderProgram);

    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error(
            "Unable to initialize the shader program: " +
            gl.getProgramInfoLog(shaderProgram)
        );
    }
    return shaderProgram;
}
export function build_program(gl: WebGLRenderingContext, fSource: string, vsSource: string): WebGLProgram | null {
    // Vertex shader source code
    const shaderProgram = create_shader_program(gl);
    const vertexShader = compile_vertex_shader(gl, fSource);
    const fragmentShader = compile_fragment_shader(gl, vsSource);
    if (!vertexShader || !fragmentShader) {
        throw new Error("compilation failure: " + gl.getError());
    }
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


    return link_shaders(gl, shaderProgram, vertexShader, fragmentShader);


}
export function bind_data_to_shaders(gl: WebGLRenderingContext, model: Model, shaderProgram: WebGLShader) {
    if (!model.texture) {
        return;
    }
    const vertexBuffer = create_vertex_buffer(gl, model.vertices);

    const textureCoordBuffer = create_texture_buffer(gl, model.texture)

    const vertexPosition = gl.getAttribLocation(
        shaderProgram,
        "aVertexPosition"
    );
    gl.enableVertexAttribArray(vertexPosition);
    // window.bound_locations = window.bound_locations || []
    // window.bound_locations.push(vertexPosition)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(vertexPosition, 3, gl.FLOAT, false, 0, 0);
    if (model.colors) {
        const colorBuffer = create_color_buffer(gl, model.colors)
        const vertexColorPosition = gl.getAttribLocation(
            shaderProgram, "aVertexColor");
        //window.bound_locations.push(vertexColorPosition)

        console.log(vertexPosition, vertexColorPosition, gl.getError());

        gl.enableVertexAttribArray(vertexColorPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.vertexAttribPointer(vertexColorPosition, 4, gl.FLOAT, false, 0, 0);
    }
    if (model.normals) {
        const normalBuffer = create_normal_buffer(gl, model.normals)
        const normalPosition = gl.getAttribLocation(
            shaderProgram,
            "aNormalDirection"
        );
        //window.bound_locations.push(normalPosition)
        gl.enableVertexAttribArray(normalPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.vertexAttribPointer(normalPosition, 3, gl.FLOAT, false, 0, 0);
    }


    if (textureCoordBuffer) {
        const textureCoordPosition = gl.getAttribLocation(
            shaderProgram,
            "aTextureCoord"
        );
        gl.enableVertexAttribArray(textureCoordPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
        gl.vertexAttribPointer(textureCoordPosition, 2, gl.FLOAT, false, 0, 0);
    }
    const vectorIndexPosition = gl.getAttribLocation(
        shaderProgram,
        "aVectorIndex"
    );

}


export async function update_texture_rect(gl: WebGLRenderingContext,
    texture: WebGLTexture,
    texture_canvas: HTMLCanvasElement,
    rect: Rect
) {
    const bmp = await createImageBitmap(texture_canvas, rect.x, rect.y, rect.w, rect.h);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        rect.x,
        rect.y,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bmp
    );
    gl.bindTexture(gl.TEXTURE_2D, texture);
}

export function create_texture_from_canvas(gl: WebGLRenderingContext,
    texture_canvas: HTMLCanvasElement) {
    const texture = gl.createTexture();
    const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });

    const imageData = texture_canvas && texture_context ?
        texture_context.getImageData(0, 0, texture_canvas.width, texture_canvas.height)
        : new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        imageData
    );
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return texture;
}
export function draw_model(gl: WebGLRenderingContext, shader_program: WebGLShader, uniforms: Uniforms, model: any, vertex_count: number) {
    if (model.vertices && vertex_count && vertex_count != model.vertices.length * 3) {
        throw new Error(`Bad vertex count ${vertex_count} != ${model.vertices.length}*3} `)
    }
    if (model.normals && vertex_count && vertex_count != model.normals.length * 3) {
        throw new Error(`Bad normal count, vertex count: ${vertex_count} != ${model.normals.length}*9}`)
    }
    if (model.vertices && model.normals && model.vertices.length != model.normals.length) {
        throw new Error(`Bad normal count, vertices:${model.vertices.length} != normals:${model.normals.length}`)
    }

    Object.entries(uniforms).forEach((entry) => {
        const name = entry[0]
        const type: string = entry[1].type as string
        const value = entry[1].value
        const uniform_location = gl.getUniformLocation(shader_program, name);
        if (uniform_location != -1) {
            const binding_function_name = type as keyof WebGLRenderingContext
            const binding_function =
                (gl[binding_function_name] as Function).bind(gl);
            binding_function(uniform_location, false, value);
        }
    })
    bind_data_to_shaders(gl, model, shader_program);
    gl.useProgram(shader_program);
    gl.drawArrays(gl.TRIANGLES, 0, vertex_count || model.vertices.length / 3);
    unbind_data(gl);
};
export function unbind_data(gl: WebGLRenderingContext) {
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    gl.useProgram(null);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.clearStencil(0);
    //gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < maxAttributes; i++) {
        gl.disableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttrib1f(i, 0);
    }

}


import * as THREE from 'three'
import * as glMatrix from 'gl-matrix'

export type Uniforms = {
    [key: string]: {
        type?: string,
        value: any
    }
}
export type Model = {
    vertices: Array<number>,
    colors?: Array<number>,
    normals?: Array<number>,
    texture?: Array<number>
}

export function matrix_uniforms(rotation: glMatrix.quat): Uniforms {
    const rotation_matrix_4x4 = glMatrix.mat4.create();
    glMatrix.mat4.fromQuat(rotation_matrix_4x4, rotation);

    const viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, [0, -.1, 5], [0, -.1, 0], [0, 1, 0]);
    const projectionMatrix = glMatrix.mat4.create();
    glMatrix.mat4.perspective(projectionMatrix, Math.PI * 0.15, 1, 1, 10.0);

    glMatrix.mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix)

    const rotationMatrix3x3 = glMatrix.mat3.create();
    glMatrix.mat3.fromMat4(rotationMatrix3x3, rotation_matrix_4x4);
    return {
        "projector": {
            type: 'uniformMatrix4fv',
            value: projectionMatrix
        },
        "model_transformer": {
            type: 'uniformMatrix3fv',
            value: rotationMatrix3x3
        },
    }
}

export function model_to_geometry(model: Model): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setDrawRange(0, Math.floor(model.vertices.length / 3));
    geometry.setAttribute('aVertexPosition',
        new THREE.BufferAttribute(new Float32Array(model.vertices), 3));
    if (model.normals) {
        geometry.setAttribute('aNormalDirection',
            new THREE.BufferAttribute(new Float32Array(model.normals), 3));
    }
    if (model.texture) {
        geometry.setAttribute('aTextureCoord',
            new THREE.BufferAttribute(new Float32Array(model.texture), 2));
    }
    if (model.colors) {
        geometry.setAttribute('aVertexColor',
            new THREE.BufferAttribute(new Float32Array(model.colors), 4));
    }
    return geometry;
}

export function create_canvas_texture(texture_canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(texture_canvas);
    texture.flipY = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

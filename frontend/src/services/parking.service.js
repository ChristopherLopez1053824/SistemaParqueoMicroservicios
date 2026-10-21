import { request } from './api';

export async function listSpaces() {
    const { data, meta } = await request('/api/parking/spaces');
    return { spaces: data, total: meta?.total ?? data.length };
}

export async function getSpace(id) {
    return (await request(`/api/parking/spaces/${id}`)).data;
}

export async function createSpace({ code, level, spaceType }) {
    return (await request('/api/parking/spaces', {
        method: 'POST',
        body: { code, level, spaceType }
    })).data;
}

export async function updateSpaceStatus(id, status) {
    return (await request(`/api/parking/spaces/${id}/status`, {
        method: 'PATCH',
        body: { status }
    })).data;
}

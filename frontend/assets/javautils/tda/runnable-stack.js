function getRunnableMemberStackText(member) {
    return Array.isArray(member?.rawBlock)
        ? member.rawBlock.join('\n').trim()
        : '';
}

function getRunnableMemberStackGroupKey(member) {
    const normalizedFrames = Array.isArray(member?.normalizedFrames)
        ? member.normalizedFrames
        : [];

    if (normalizedFrames.length) {
        return normalizedFrames.slice(0, 8).join(' | ');
    }

    const clusterFrames = Array.isArray(member?.clusterRepresentativeFrames)
        ? member.clusterRepresentativeFrames
        : [];

    if (clusterFrames.length) {
        return clusterFrames.slice(0, 8).join(' | ');
    }

    return String(member?.topFrame || '').trim();
}

export function groupRunnableClusterMembersByStack(members) {
    const groups = new Map();

    for (const member of members || []) {
        const key = getRunnableMemberStackGroupKey(member);

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                stackText: getRunnableMemberStackText(member),
                topFrame: member?.topFrame || '',
                members: []
            });
        }

        groups.get(key).members.push(member);
    }

    return Array.from(groups.values()).sort((a, b) => {
        if (b.members.length !== a.members.length) {
            return b.members.length - a.members.length;
        }
        return String(a.topFrame || '').localeCompare(String(b.topFrame || ''));
    });
}

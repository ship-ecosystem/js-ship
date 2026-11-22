export function imageInspection(args) {
 if (args[0] !== 'docker' || args[1] !== 'image' || args[2] !== 'inspect') return undefined;
 const repository = args[3].split('@')[0].replace(/:[^/:]+$/, '');
 return JSON.stringify([{ Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'amd64', RepoDigests: [`${repository}@sha256:${'b'.repeat(64)}`] }]);
}

// Faux réseaux pour les tests du module « Jaquettes de jeux » : une vraie petite image (JPEG valide d'un pixel) servie par les hôtes d'images, jamais le réseau réel.
export const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
export const imageReply = (type = "image/jpeg", bytes = JPEG) => new Response(bytes, { status: 200, headers: { "content-type": type, "content-length": String(bytes.length) } });
/** Les hôtes dont le module accepte de copier des images. */
export const IMAGE_HOSTS = new Set(["media.rawg.io", "static-cdn.jtvnw.net", "shared.akamai.steamstatic.com"]);

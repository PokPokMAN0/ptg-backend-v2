import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { pipeline } from "node:stream/promises";
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const UPLOAD_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "public",
  "profile-pics",
);
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

// ------------------------------------------------------------------
// POST – upload a new profile photo
// ------------------------------------------------------------------
async function uploadProfilePhoto(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = request.user as { sub: string };
  const data = await request.file();
  if (!data) {
    return reply
      .status(400)
      .send({ success: false, error: "No image provided." });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(data.mimetype)) {
    return reply
      .status(400)
      .send({ success: false, error: "Only JPG, PNG, WEBP allowed." });
  }

  const ext = ".jpg";
  const filename = `${user.sub}${ext}`;
  const filepath = join(UPLOAD_DIR, filename);

  const transform = sharp()
    .resize(500, 500, { fit: "cover", position: "centre" })
    .jpeg({ quality: 80, progressive: true });

  await pipeline(data.file, transform, createWriteStream(filepath));

  const imageUrl = `/profile-pics/${filename}`;

  await request.server.prisma.user.update({
    where: { id: user.sub },
    data: { image_url: imageUrl },
  });

  return reply.send({ success: true, data: { image_url: imageUrl } });
}

// ------------------------------------------------------------------
// DELETE – remove the profile photo
// ------------------------------------------------------------------
async function deleteProfilePhoto(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = request.user as { sub: string };

  // Find current user to get the old image path
  const currentUser = await request.server.prisma.user.findUnique({
    where: { id: user.sub },
    select: { image_url: true },
  });

  // Remove file from disk if it exists
  if (currentUser?.image_url) {
    const filename = currentUser.image_url.split("/").pop();
    if (filename) {
      const filepath = join(UPLOAD_DIR, filename);
      if (existsSync(filepath)) {
        unlinkSync(filepath);
      }
    }
  }

  // Clear image_url in the database
  await request.server.prisma.user.update({
    where: { id: user.sub },
    data: { image_url: null },
  });

  return reply.send({ success: true, data: { image_url: null } });
}

export async function customerPhotoRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/v1/customer/account/photo",
    { preHandler: [authenticate] },
    uploadProfilePhoto,
  );
  fastify.delete(
    "/v1/customer/account/photo",
    { preHandler: [authenticate] },
    deleteProfilePhoto,
  );
}

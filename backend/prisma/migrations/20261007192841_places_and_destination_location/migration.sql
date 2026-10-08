-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "formattedAddress" TEXT,
ADD COLUMN     "placeProvider" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "destinationFormattedAddress" TEXT,
ADD COLUMN     "destinationLatitude" DOUBLE PRECISION,
ADD COLUMN     "destinationLongitude" DOUBLE PRECISION,
ADD COLUMN     "destinationPlaceId" TEXT,
ADD COLUMN     "destinationPlaceProvider" TEXT;

-- IDs externos gravados antes deste recurso não informavam o provedor: não há como reutilizá-los.
UPDATE "Activity" SET "placeId" = NULL WHERE "placeId" IS NOT NULL;
-- Coordenadas incompletas (não deveriam existir; a API já exigia o par) viram "sem localização".
UPDATE "Activity" SET "latitude" = NULL, "longitude" = NULL WHERE ("latitude" IS NULL) <> ("longitude" IS NULL);

-- Coordenadas sempre em par e dentro dos limites; o lugar externo exige provedor e coordenadas.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "Activity_coordinates_range" CHECK (
    "latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT "Activity_place_ref" CHECK (
    ("placeId" IS NULL) = ("placeProvider" IS NULL) AND ("placeId" IS NULL OR "latitude" IS NOT NULL)
  );

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_destination_coordinates_pair" CHECK (("destinationLatitude" IS NULL) = ("destinationLongitude" IS NULL)),
  ADD CONSTRAINT "Trip_destination_coordinates_range" CHECK (
    "destinationLatitude" IS NULL
    OR ("destinationLatitude" BETWEEN -90 AND 90 AND "destinationLongitude" BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT "Trip_destination_place_ref" CHECK (
    ("destinationPlaceId" IS NULL) = ("destinationPlaceProvider" IS NULL)
    AND ("destinationPlaceId" IS NULL OR "destinationLatitude" IS NOT NULL)
  );

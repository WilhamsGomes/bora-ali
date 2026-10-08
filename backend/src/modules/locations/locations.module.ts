import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { DisabledGeocodingProvider, GeoapifyProvider } from './geoapify.provider';
import { GeocodingProvider } from './geocoding-provider';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { PlaceCacheCleanupService } from './place-cache-cleanup.service';

@Module({
  controllers: [LocationsController],
  providers: [
    LocationsService,
    PlaceCacheCleanupService,
    {
      provide: GeocodingProvider,
      inject: [AppConfig],
      useFactory: (config: AppConfig): GeocodingProvider =>
        config.get('GEOCODING_PROVIDER') === 'geoapify' ? new GeoapifyProvider(config) : new DisabledGeocodingProvider(),
    },
  ],
})
export class LocationsModule {}

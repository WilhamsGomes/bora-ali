import { Module } from '@nestjs/common';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [ItineraryModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}

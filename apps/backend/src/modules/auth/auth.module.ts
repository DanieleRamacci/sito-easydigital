import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtSessionService } from './jwt-session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [JwtSessionService],
  exports: [JwtSessionService],
})
export class AuthModule {}

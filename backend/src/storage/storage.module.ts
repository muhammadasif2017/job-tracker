import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_SERVICE } from './storage.service.js';
import { LocalStorageService } from './local-storage.service.js';
import { OracleStorageService } from './oracle-storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('STORAGE_DRIVER', 'local');
        if (driver === 'oracle') {
          return new OracleStorageService(config);
        }
        return new LocalStorageService(config);
      },
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}

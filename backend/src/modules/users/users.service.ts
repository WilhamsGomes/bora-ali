import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import type { UserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  static toDto(user: Pick<User, 'id' | 'name' | 'email' | 'createdAt'>): UserDto {
    return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
  }

  async getById(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Usuário não encontrado.');
    return UsersService.toDto(user);
  }

  async updateName(id: string, name: string): Promise<UserDto> {
    const user = await this.prisma.user.update({ where: { id }, data: { name } });
    return UsersService.toDto(user);
  }
}

import mongoose, { Schema, type Document } from 'mongoose';

export interface ISession extends Document {
  hash: string;
  previousHash?: string;
  rotatedAt?: Date;
  userGUID: string;
  kind: 'anon' | 'user';
  expiresAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    hash: { type: String, required: true, unique: true },
    previousHash: { type: String, index: { sparse: true } },
    rotatedAt: { type: Date },
    userGUID: { type: String, required: true, index: true },
    kind: { type: String, enum: ['anon', 'user'], required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'sessions',
  },
);

export const Sessions =
  (mongoose.models.Sessions as mongoose.Model<ISession>) || mongoose.model<ISession>('Sessions', SessionSchema);

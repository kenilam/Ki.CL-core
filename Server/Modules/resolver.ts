import {
  DateTimeResolver,
  EmailAddressResolver,
  UUIDResolver,
  JWTResolver,
  JSONObjectResolver,
  URLResolver,
  NonEmptyStringResolver,
} from 'graphql-scalars';

export default {
  DateTime: DateTimeResolver,
  EmailAddress: EmailAddressResolver,
  UUID: UUIDResolver,
  JWT: JWTResolver,
  JSONObject: JSONObjectResolver,
  URL: URLResolver,
  NonEmptyString: NonEmptyStringResolver,
};

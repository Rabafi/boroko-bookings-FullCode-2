// node-postgres currently exposes Pool as an ESM constructor value while its
// CommonJS declaration also names the instance type Pool. Derive the instance
// type from the public constructor so strict NodeNext builds work in both
// resolution modes.
export type Pool = InstanceType<typeof import('pg').Pool>
export type { PoolClient, QueryResult, QueryResultRow } from 'pg'

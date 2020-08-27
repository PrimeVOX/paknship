export type Map = {[key: string]: string};

export interface IFailure {
  refId: string;
  message: string;
}

export interface ISuccess {
  refId: string;
  gunId: string;
  message: string;
  // more here???
}

// not sure what we will want here???
export interface IResponse {
  // totalProcessed: number;
  failure: IFailure[];
  success: ISuccess[];
}

export interface ICharge {
  status: number;
  message: string;
}

// a generic object that references some id and may have email info
export interface IPakRef {
  refId: string;
  email: string;
  data?: string;
  charge?: ICharge;
}

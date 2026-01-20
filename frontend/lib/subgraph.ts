import { GraphQLClient, gql } from 'graphql-request';

type Belief = {
  id: string;
  totalStaked: string;
  stakerCount: number;
  createdAt: string;
  lastStakedAt: string;
  stakes: Array<{
    stakedAt: string;
    active: boolean;
  }>;
};

const beliefsQuery = gql`
  query GetBeliefs {
    beliefs(first: 1000, orderBy: totalStaked, orderDirection: desc) {
      id
      totalStaked
      stakerCount
      createdAt
      stakes(where: { active: true }, orderBy: stakedAt, orderDirection: desc, first: 1) {
        stakedAt
        active
      }
    }
  }
`;

export async function getBeliefs(): Promise<Belief[]> {
  const endpoint = process.env.NEXT_PUBLIC_SUBGRAPH_URL;
  if (!endpoint) {
    throw new Error('NEXT_PUBLIC_SUBGRAPH_URL is not set');
  }

  const client = new GraphQLClient(endpoint);
  const data = await client.request<{ beliefs: Belief[] }>(beliefsQuery);

  // Calculate lastStakedAt from the most recent active stake
  return data.beliefs.map((belief) => ({
    ...belief,
    lastStakedAt: belief.stakes[0]?.stakedAt || belief.createdAt,
  }));
}

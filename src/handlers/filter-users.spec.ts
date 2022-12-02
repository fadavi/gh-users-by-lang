import { expect } from 'chai'
import { prepareResponse, prepareSearchOptions } from './filter-users'
import * as githubSearch from '../lib/github/search-users'
import type { SearchUsersOptions, SearchUsersResponse } from '../lib/github/search-users'
import * as sinon from 'sinon'
import { app } from '../app'
import { ClientError } from 'graphql-request'
import { GraphQLRequestContext } from 'graphql-request/dist/types'


describe('handlers/filter-users', () => {
  context('prepareResponse', () => {
    it('sets non-existing properties to null (0 for followersCount)', () => {
      const data = {
        search: {
          edges: [{
            node: {}
          }],
          pageInfo: {},
          totalCount: 1234
        }
      }

      const { users, pageInfo, totalCount } = prepareResponse(data)

      expect(pageInfo).to.be.eql(data.search.pageInfo)
      expect(totalCount).to.be.eql(data.search.totalCount)
      expect(users).to.be.an('array').with.lengthOf(1)
      expect(users[0]).to.be.eql({
        username: null,
        name: null,
        avatarUrl: null,
        followersCount: 0
      })
    })
  })

  context('prepareSearchOptions', () => {
    it('sets last and before when before is truthy', () => {
      const opts = prepareSearchOptions({
        langs: 'c',
        limit: 123,
        before: 'cursor'
      })

      expect(opts).to.be.eql({
        query: 'language:c',
        last: 123,
        before: 'cursor'
      })
    })

    it('sets first and after when after is truthy', () => {
      const opts = prepareSearchOptions({
        langs: 'c',
        limit: 123,
        after: 'cursor'
      })

      expect(opts).to.be.eql({
        query: 'language:c',
        first: 123,
        after: 'cursor'
      })
    })

    it('sets first when before and after are falsey', () => {
      const opts = prepareSearchOptions({
        langs: 'c',
        limit: 123
      })

      expect(opts).to.be.eql({
        query: 'language:c',
        first: 123
      })
    })
  })
})

describe('endpoints', () => {
  let searchUsersStub: sinon.SinonStub<
    [opts: SearchUsersOptions], Promise<SearchUsersResponse>
  >

  async function getUsers (query: Record<string, string | string[]> = {}) {
    return app.inject({
      method: 'GET',
      url: '/users',
      query
    })
  }

  beforeEach(async () => {
    searchUsersStub = sinon
      .stub(githubSearch, 'searchUsers')
      .throws(new Error('fake behavior is not implemented'))
  })

  afterEach(() => {
    sinon.restore()
  })

  context('GET /users', () => {
    it('responds with 400 in case of invalid query params', async () => {
      const validQuery = Object.freeze({
        langs: 'java,c++',
        limit: '20'
      })

      let res = await getUsers({
        ...validQuery,
        langs: ''
      })
      expect(res.statusCode).to.be.equal(400)

      res = await getUsers({
        ...validQuery,
        limit: '-1'
      })
      expect(res.statusCode).to.be.equal(400)

      res = await getUsers({
        ...validQuery,
        before: ''
      })
      expect(res.statusCode).to.be.equal(400)

      res = await getUsers({
        ...validQuery,
        after: ''
      })
      expect(res.statusCode).to.be.equal(400)
    })

    it('responds with 409 when both cursors are specified', async () => {
      const res = await getUsers({
        langs: 'c',
        before: 'cursor1',
        after: 'cursor2'
      })
      expect(res.statusCode).to.be.equal(409)
    })

    context('when github API fails', () => {
      it('responds with 400 in case of invalid pagination cursor', async () => {
        const clientError = new ClientError(
          {
            errors: [{ type: 'INVALID_CURSOR_ARGUMENTS' }],
            status: null
          },
          {} as GraphQLRequestContext
        )
        searchUsersStub.rejects(clientError)

        const res = await getUsers({ langs: 'c' })

        expect(res.statusCode).to.be.equal(400)
        expect(res.json())
          .to.be.an('object')
          .which.has.property('message', 'Invalid pagination cursor')
      })

      it('responds with 500 in case of unknown error', async () => {
        searchUsersStub.rejects(new Error('unknown error'))

        const res = await getUsers({ langs: 'c' })

        expect(res.statusCode).to.be.equal(500)
      })

      it('responds with 503 in case of unhandled client error', async () => {
        const err = new ClientError(
          { status: 200, errors: [] },
          {} as GraphQLRequestContext
        )
        searchUsersStub.rejects(err)

        const res = await getUsers({ langs: 'c' })

        expect(res.statusCode).to.be.equal(503)
      })
    })

    it('provides only next page link on the first page', async () => {
      searchUsersStub.resolves({
        search: {
          totalCount: 1234,
          edges: [],
          pageInfo: {
            hasNextPage: true,
            endCursor: 'endcursor'
          }
        }
      })

      const res = await getUsers({ langs: 'c' })

      expect(res).to.have.property('statusCode', 200)
      expect(res.json())
        .to.have.property('links').which.is.an('object')
        .that.has.property('next').which.is.a('string').and.is.not.empty
    })

    it('provides only prev page link on the last page', async () => {
      searchUsersStub.resolves({
        search: {
          totalCount: 1234,
          edges: [],
          pageInfo: {
            hasPreviousPage: true,
            startCursor: 'startcursor'
          }
        }
      })

      const res = await getUsers({ langs: 'c' })

      expect(res).to.have.property('statusCode', 200)
      expect(res.json())
        .to.have.property('links').which.is.an('object')
        .that.has.property('prev').which.is.a('string').and.is.not.empty
    })

    it('provides prev/next page link on middle pages', async () => {
      searchUsersStub.resolves({
        search: {
          totalCount: 1234,
          edges: [],
          pageInfo: {
            hasNextPage: true,
            endCursor: 'endcursor',
            hasPreviousPage: true,
            startCursor: 'startcursor'
          }
        }
      })

      const res = await getUsers({ langs: 'c' })
      const body = res.json()

      expect(res).to.have.property('statusCode', 200)
      expect(body)
        .to.have.property('links').which.is.an('object')
        .and.includes.all.keys('prev', 'next')
      expect(body.links.prev).to.be.a('string').which.is.not.empty
      expect(body.links.next).to.be.a('string').which.is.not.empty
    })

    it('guarantees user info props even if something is null', async () => {
      const john = Object.freeze({
        username: 'john',
        name: 'John Smith',
        followers: Object.freeze({
          count: 10
        })
      })

      searchUsersStub.resolves({
        search: {
          totalCount: 1234,
          edges: [{ node: john }, { node: {} }],
          pageInfo: {}
        }
      })

      const res = await getUsers({ langs: 'c' })
      const body = res.json()

      expect(res).to.have.property('statusCode', 200)
      expect(body)
        .to.have.property('users').which.is.an('array')
        .with.lengthOf(2).that.is.eql([{
          username: john.username,
          name: john.name,
          avatarUrl: null,
          followersCount: john.followers.count
        }, {
          username: null,
          name: null,
          avatarUrl: null,
          followersCount: 0
        }])
    })
  })
})

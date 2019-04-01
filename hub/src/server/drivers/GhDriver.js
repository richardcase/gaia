/* @flow */

import octokit from '@octokit/rest'
import logger from 'winston'
import { BadPathError } from '../errors'
import type { DriverModel } from '../driverModel'
import type { Readable } from 'stream'

type GH_CONFIG_TYPE = {
    ghConfig: {
        authtype ? : string,
        token ? : string,
        baseurl ? : string,
        owner ? : string,
        repo ? : string,
        path ? : string,
        ref? : string
    },
    bucket: string
}

class GhDriver implements DriverModel {
    oc: octokit
    bucket: string
    owner: string
    repo: string
    path: string
    ref: string

    constructor(config: GH_CONFIG_TYPE) {
        if (!config.ghConfig || Object.keys(config.ghConfig).length === 0) {
            throw new Error('Configuration is missing for GitHub driver')
        }

        const {
            authtype,
            token,
            baseurl,
            owner,
            repo,
            path,
            ref
        } = config.ghConfig

        switch (authtype) {
            case 'token':
                if (!token || token === '') {
                    throw new Error('Using token authentication but no token supplied')
                }
                break
            case 'oauth':
                if (!token || token === '') {
                    throw new Error('Using oauth authentication but no token supplied')
                }
                break
            default:
                throw new Error('Using an unsupported auth type. Only "token" or "oauth" are supported')
        }

        if (!owner || owner === '') {
            throw new Error('You must supply an owner')
        }
        this.owner = owner
        if (!repo || repo === '') {
            throw new Error('You must supply an repo')
        }
        this.repo = repo
        if (!path || path === '') {
            logger.info('setting path to / as its not supplied in GitHub driver configuration')
            this.path = '/'
        } else {
            this.path = path
        }
        if (!ref || ref === '') {
            logger.info('setting ref to "master" as its not supplied in GitHub driver configuration')
            this.ref = 'master'
        } else {
            this.ref = ref
        }
        
        this.oc = new octokit({
            headers: {
                accept: 'application/vnd.github.v3+json',
                'user-agent': 'blockstack-gaia-githubdriver' //TODO: add version number
            },
            baseUrl: baseurl
        })

        logger.info('about to authenticate to GitHub')
        this.oc.authenticate({
            type: authtype,
            token: token
        })
    }

    static isPathValid(path: string){
        // for now, only disallow double dots.
        return (path.indexOf('..') === -1)
    }

    getReadURLPrefix(): string {
        return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.ref}/`
    }

    performWrite(args: {
        path: string,
        storageTopLevel: string,
        stream: Readable,
        contentLength: number,
        contentType: string
    }): Promise < string > {

        if (!GhDriver.isPathValid(args.path)) {
            return Promise.reject(new BadPathError('Invalid Path'))
        }

        const contentPath = `${args.storageTopLevel}/${args.path}`

        const downloadPath = `${this.getReadURLPrefix()}/${contentPath}`

        const ghParams = {
            owner: this.owner,
            repo: this.repo,
            path: contentPath,
            message: 'TODO: add comment',
            branch: this.ref, //TODO: change to branch
            committer: {
                name: 'gaia',
                email: 'someone@somewhere'
            },
            content: ''
        }

        // return new Promise((resolve, reject) => {
        return new Promise((resolve, reject) => {
            let contents = ''
            args.stream.on('data', function(chunk) {
                contents = contents + chunk
            })
            .on('end', function () {
                ghParams.content = contents
                this.oc.repos.createFile(ghParams).then(results => {
                    //TODO: test for failure
    
                    logger.debug(`stored ${contentPath} with commit ${results.data.commit.sha}`)
                    return resolve(downloadPath)
                })
            })
            .on('error', (err) => {
                logger.error(`failed to store ${contentPath} using GitHub driver`)
                reject(new Error('GitHub storage driver failed: failed to write file' +
                    `${contentPath} in bucket ${this.bucket}: ${err}}`))
            })            
        })
    }

    listFiles(storageTopLevel: string, page: ? string) {
        // returns Promise<{ entries: Array<string>, page: ?string} > {
        const params: {
            owner: string,
            repo: string,
            path: string,
            ref ? : string
        } = {
            owner: this.owner,
            repo: this.repo,
            path: this.path + '/' + storageTopLevel
        }
        if (page) {
            logger.debug('TODO: handle page')
        }

        // return new Promise((resolve, reject) => {
        return new Promise((resolve) => {
            return this.oc.repos.getContents(params).then(results => {
                const filenames = []
                results.forEach(result => {
                    filenames.push(result.name)
                })
                const ret = {
                    entries: filenames,
                    page: null
                }
                return resolve(ret)
            })
        })

    }
}

module.exports = GhDriver

+++
date = '2025-12-09'
draft = false
title = 'Publish to NPM from GitHub Actions using OIDC'
summary = 'Learn how to automate npm package publishing through GitHub Actions using OpenID Connect (OIDC) - no API keys or access tokens required.'
tags = ['npm', 'github-actions', 'oidc', 'ci-cd', 'nodejs']
+++

I frequently create developer tools and publish node packages on npmjs, but recently classic tokens got deprecated, granular tokens are limited to 90 days, require 2FA and a bunch of changes were introduced to improve security around publishing packages. More about that on [this GitHub announcement](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/).

One of the improvements was the introduction of **[OpenID Connect](https://openid.net/developers/how-connect-works/) (OIDC)**, which allows developers to publish npm packages through GitHub Actions, without having to setup any kind of API key or access token. 

Today we're having a look at how you can implement it for your packages as well.

---

## Step 1: Setup a Node Package (or skip if you already have one)

As an example, we'll create a fresh package which just logs "hello world" to console.

> **NOTE:** This package is only meant as a demo for this blog. It is not recommended to create such packages for yourself — you should just setup OIDC on your existing packages :)

```bash
mkdir npm-oidc-demo && cd npm-oidc-demo
npm init -y
touch index.js
```

**index.js:**
```javascript
export function helloWorld() {
    console.log("Hello World");
}
```

**package.json:**
```json
{
  "name": "npm-oidc-demo",
  "version": "1.0.1",
  "description": "A simple hello world package",
  "main": "index.js",
  "type": "module",
  "exports": {
    ".": "./index.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ankushKun/npm-oidc-demo"
  },
  "keywords": [
    "npm",
    "oidc"
  ],
  "author": "",
  "license": "ISC"
}
```

> **Note:** An already published package is required to use OIDC (might change in the future, who knows…)

Run `npm login` and follow the steps to link the npm CLI with your npmjs account. When successful, run `npm whoami` and it should print your username.

**Ready for publishing:**

> If you ignored the previous note and still followed this guide to publish the demo package yourself, you might need to change your package name as I have already used “npm-oidc-demo”

```bash
$ npm whoami
ankushkun

$ npm publish
npm notice 
npm notice 📦  npm-oidc-demo@1.0.0
...
+ npm-oidc-demo@1.0.0
```

The package is now available at [`https://www.npmjs.com/package/npm-oidc-demo`](https://www.npmjs.com/package/npm-oidc-demo).

---

## Step 2: Update OIDC Details on Package Settings

Head over to the settings tab on your freshly published package and select **GitHub Actions** as the trusted publisher.

![npmjs package settings tab](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*s0fSghe8DIxQPw6K-OhozA.png)

![GitHub actions trusted publisher settings](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*4Fc2oJ3_Ijr8uLga0P4v_A.png)

I have already created a GitHub repo at [`ankushKun/npm-oidc-demo`](https://github.com/ankushKun/npm-oidc-demo), now we just need to create a workflow file. Put this inside `.github/workflows/publish.yml`:


**publish.yml:**
```yaml
name: Publish to npm

on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20.x"
          registry-url: "https://registry.npmjs.org"

      - name: Update npm
        run: npm install -g npm@latest

      - name: Publish to npm
        run: npm publish
```

Push the YAML file to the repo and update the OIDC details on the package settings. I have kept the environment name empty because I don't have any explicit environment setup for actions.

![updated oidc details](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*fjfYVS4FfV6Av8xqeaMNqw.png)

update and save the settings.

Now when you create a new release on the github repo, a workflow will start running which will publish the package to npm with provenance.

---

## Step 3: Create a Release on GitHub to Run the Action

Now it's time to trigger the workflow! Go back to the github repo and create a new release.

Once created, the GitHub Action will automatically start running. You can monitor the progress in the **Actions** tab of your repository.

![successful workflow](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*5vdxP7PcaEI51ntX42K5_A.png)

When the workflow completes successfully, your package will be published to npm with provenance — proving it was built and published through your trusted CI/CD pipeline!

![published package](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*CYJjIDfnPq3HfLTo8G37vA.png)

And that’s how one can setup cicd to publish npm packages from github actions without having to create any access tokens themselves!
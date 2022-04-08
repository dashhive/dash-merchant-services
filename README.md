# dash-payment-webhooks

Get webhooks when your address is paid, duh!

## Pre-Requisites

You'll need `dashd` already.

See <https://github.com/dashhive/dashd-installer/issues/4>.

## Setup

```bash
rsync -avhP example.env .env
rsync -avhP ./dashcore-node.example.json ./dashcore-node.json
```

```bash
npm ci
npm run start
```

## API

```txt
POST /api/webhooks
Bearer my-api-access-token
{
    url: "https://user@my-super-long-token:example.com/api/dash/payment-received",
    address: "Xxxxxxxxxxxxxxxxxxx",
}

{
    url: "https://user@my-s*************en:example.com/api/dash/payment-received",
    address: "Xxxxxxxxxxxxxxxxxxx",
}
```

To create a webhook token scoped to certain allowed hostnames:

```bash
node ./bin/gentoken.js example.com,example.net
```

Then give the `dwh_` part to the customer, and save the line in `./tokens.json`.

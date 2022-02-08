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

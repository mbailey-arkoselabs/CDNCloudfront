# Server Side - Cloudfront CDN Lambda proxy

This is an example of an AWS Cloudfront Lambda @ Edge function that can be setup as a cdn proxy. This function would be setup to work as a proxy for requests, it would intercept any requests extract an Arkose token from the request and verify the token. If the verification is successful the request would continue, if not successful the proxy can redirect to an error page.


## Configuration
This function includes several variables that can be setup to custmise the behaviour of the function.

| Variable                  | Description                                                     | Default                                |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| privateKey          | The Arkose private key to use in this function                        | `11111111-1111-1111-1111-111111111111` |
| errorUrl            | A url to redirect error states to if required                         | `https://www.arkoselabs.com`           |
| tokenMethod         | The method used for extracting the token, can be `body` or `cookie`   | `body`                                 |
| tokenIdentifier     | The name of the field or cookie the token will be passed in           | `arkose-token`                         |
| failOpen            | A boolean to indicate if we should fail open or not                   | `true`                                 |
| verifyMaxRetryCount | The number of times to retry verification if there is an error        | `3`                                    |
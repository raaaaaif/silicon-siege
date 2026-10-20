"""Reproducible tiny MLP + static PTQ. No test-set calibration or model selection.
Run remotely with numpy==2.2.6. All rounding is floor(x+0.5), including negatives.
"""
import pathlib, json, hashlib, urllib.request, io, zipfile, subprocess
import numpy as np
OUT=pathlib.Path('build/depth'); OUT.mkdir(parents=True,exist_ok=True)
url='https://archive.ics.uci.edu/static/public/80/optical+recognition+of+handwritten+digits.zip'
raw=urllib.request.urlopen(url).read(); z=zipfile.ZipFile(io.BytesIO(raw))
def read(name):
    blob=z.read(next(n for n in z.namelist() if n.endswith(name)))
    return np.loadtxt(io.BytesIO(blob),delimiter=',',dtype=np.int64),hashlib.sha256(blob).hexdigest()
train,trainhash=read('optdigits.tra'); test,testhash=read('optdigits.tes')
assert train.shape==(3823,65) and test.shape==(1797,65)
rng=np.random.default_rng(20261020); ids=rng.permutation(len(train)); fit,cal,val=ids[768:],ids[:256],ids[256:768]
X=train[:,:64]/16.; y=train[:,64]; XT=test[:,:64]/16.; yt=test[:,64]
W1=rng.normal(0,np.sqrt(2/64),(64,32)); b1=np.zeros(32); W2=rng.normal(0,np.sqrt(2/32),(32,10)); b2=np.zeros(10)
params=[W1,b1,W2,b2]; mom=[np.zeros_like(p) for p in params]; vel=[p.copy() for p in mom]
def forward(x):
    h=np.maximum(0,x@W1+b1); return h,h@W2+b2
best=-1; best_epoch=0; t=0; history=[]
for epoch in range(100):
    order=rng.permutation(fit)
    for start in range(0,len(order),128):
        ix=order[start:start+128]; x=X[ix]; h,logits=forward(x)
        prob=np.exp(logits-logits.max(1,keepdims=True)); prob/=prob.sum(1,keepdims=True)
        prob[np.arange(len(ix)),y[ix]]-=1; prob/=len(ix)
        dh=(prob@W2.T)*(h>0)
        grads=[x.T@dh+1e-4*W1,dh.sum(0),h.T@prob+1e-4*W2,prob.sum(0)]
        t+=1
        for j,(p,g) in enumerate(zip(params,grads)):
            mom[j]=.9*mom[j]+.1*g;vel[j]=.999*vel[j]+.001*g*g
            p-=.003*(mom[j]/(1-.9**t))/(np.sqrt(vel[j]/(1-.999**t))+1e-8)
    score=float(np.mean(forward(X[val])[1].argmax(1)==y[val]));history.append(score)
    if score>best: best=score;best_epoch=epoch+1;checkpoint=[p.copy() for p in params]
for p,q in zip(params,checkpoint):p[:]=q
roundq=lambda x:np.floor(x+.5).astype(np.int64)
def wrap(x,acc):return (x+2**(acc-1))%2**acc-2**(acc-1)
def quant_params(bits,channel):
    qmax=2**(bits-1)-1; sx=1/qmax
    hc=forward(X[cal])[0]; sh=max(float(hc.max()),1e-9)/qmax
    layers=[]
    for w,b,sa,so in [(W1,b1,sx,sh),(W2,b2,sh,1/4096)]:
        sw=np.maximum(np.max(np.abs(w),axis=0) if channel else np.full(w.shape[1],np.abs(w).max()),1e-9)/qmax
        layers.append(dict(w=np.clip(roundq(w/sw),-qmax,qmax).tolist(),bias=roundq(b/(sa*sw)).tolist(),mult=roundq(sa*sw/so*2**20).tolist()))
    return dict(bits=bits,channel=channel,input_scale=sx,hidden_scale=sh,output_scale=1/4096,shift=20,layers=layers)
def infer(x,q,acc,details=False):
    Q=2**(q['bits']-1)-1; a=np.clip(roundq(x/q['input_scale']),-Q,Q); overflow=0;clipped=0;stages=[]
    for i,l in enumerate(q['layers']):
        raw=a@np.array(l['w']);biased=raw+np.array(l['bias']); overflow+=int(np.count_nonzero((biased < -2**(acc-1)) | (biased>=2**(acc-1))))
        accum=wrap(biased,acc); scaled=np.floor((accum*np.array(l['mult'])+2**19)/2**20).astype(np.int64)
        stages.append(dict(a=a.tolist(),matmul=wrap(raw,acc).tolist(),accum=accum.tolist(),scaled=scaled.tolist()))
        if i==0: clipped=int(np.count_nonzero(scaled>Q));a=np.clip(scaled,0,Q)
    return scaled.argmax(1),overflow,clipped,stages

def wilson(k,n):
    p=k/n;d=1+1.96**2/n;c=(p+1.96**2/(2*n))/d;v=1.96*np.sqrt(p*(1-p)/n+1.96**2/(4*n*n))/d;return [float(c-v),float(c+v)]
fp=forward(XT)[1].argmax(1);fpval=forward(X[val])[1].argmax(1)
rows=[]; models=[]; vectors=[]
for bits in [4,8]:
 for channel in [False,True]:
    q=quant_params(bits,channel);models.append(q)
    for acc in [16,24,32]:
        pred,over,clip,stages=infer(XT,q,acc);vp,vo,vc,_=infer(X[val],q,acc)
        cm=np.zeros((10,10),dtype=int);np.add.at(cm,(yt,pred),1)
        diff=(pred==yt).astype(float)-(fp==yt)
        brng=np.random.default_rng(881);boot=np.array([diff[brng.integers(len(diff),size=len(diff))].mean() for _ in range(2000)])
        rows.append(dict(bits=bits,channel=channel,acc=acc,accuracy=float(np.mean(pred==yt)),accuracy_ci95=wilson(int(sum(pred==yt)),len(yt)),validation_accuracy=float(np.mean(vp==y[val])),delta_vs_float=float(diff.mean()),paired_delta_ci95=np.quantile(boot,[.025,.975]).tolist(),agreement=float(np.mean(pred==fp)),overflow_outputs=over,hidden_clips=clip,confusion=cm.tolist(),predictions=pred.tolist()))
        # Hardware layer fixtures: first four held-out examples, both layers, fixed static scales.
        _,_,_,ss=infer(XT[:4],q,acc)
        for layer,s in enumerate(ss):
            vectors.append(dict(id=f'b{bits}-c{int(channel)}-a{acc}-l{layer}',bits=bits,acc=acc,layer=layer,A=s['a'],B=q['layers'][layer]['w'],C=s['matmul']))
# Small browser artifact includes canonical held-out data and deployable integer weights.
model=dict(schema=1,seed=20261020,dataset='UCI Optical Recognition of Handwritten Digits',dataset_url=url,dataset_zip_sha256=hashlib.sha256(raw).hexdigest(),train_sha256=trainhash,test_sha256=testhash,license='CC BY 4.0; E. Alpaydin and C. Kaynak',architecture=[64,32,10],split=dict(fit=len(fit),calibration=len(cal),validation=len(val),test=len(test),fit_ids=fit.tolist(),calibration_ids=cal.tolist(),validation_ids=val.tolist()),selection=dict(epoch=best_epoch,validation_accuracy=best,epochs=100,optimizer='Adam lr .003, batch128, L2 1e-4'),float_accuracy=float(np.mean(fp==yt)),float_accuracy_ci95=wilson(int(sum(fp==yt)),len(yt)),models=models,results=rows,test=dict(x=test[:,:64].tolist(),y=yt.tolist(),float_predictions=fp.tolist()),scope='Integer GEMMs; bias, ReLU and Q20 requantization in the host. Fixed calibration from training writers; official test writers held out. Small classical digit task, not modern vision or LLM accuracy.')
(OUT/'digits.json').write_text(json.dumps(model,separators=(',',':')))
(OUT/'ml-vectors.json').write_text(json.dumps(vectors,separators=(',',':')))
print(json.dumps(dict(float_accuracy=model['float_accuracy'],best_epoch=best_epoch,rows=[{k:v for k,v in r.items() if k not in ['predictions','confusion']} for r in rows]),indent=2))
